var redis = require('redis'),
    uuid = require('node-libuuid');

/**
 * Create a new Queue
 *
 * @param {String}  options.queuename       The name of the queue to connect to.
 * @param {Integer} [options.port]          The port to use to connect to the redis
 *                                          server
 * @param {String}  [options.host]          The IP address (or hostname) of the redis
 *                                          server
 * @param {Integer} [options.concurrency=1] The number of jobs to process at any
 *                                          one time.
 * @param {Object}  [options.redis]         An instance of a redis client
 *                                          library (see node-redis for
 *                                          expected API)
 * @class Queue
 * @constructor
 */
function Queue(options, states) {
    var redisPort = options.port || process.env.REDIS_PORT;
    var redisHost = options.host || process.env.REDIS_HOST;

    var redisOptions = {
        // If items can't be placed into a queue, error rather than buffer
        // them until a connection is made
        enable_offline_queue: true
    };

    if (states.length < 2) {
        throw new Error("There must be at least 2 states, an initial state, and a state to transition to.");
    }
    this.states = states;

    this.redisClient = options.redis || redis.createClient(redisPort, redisHost, redisOptions);
    this.queueName = "__q-" + options.queuename;
    this.hashSetName = "__hs-" + options.queuename;
    this.isListening = false;

    this.maxConcurrentJobs = options.concurrency || 1;
    this.availableConcurrentSlots = this.maxConcurrentJobs;

    this.registeredProcessor = false;
}

/**
 * Send a new Job to the queue.
 *
 * @param {String}   identifier The identifier to identify the data on the
 *                              queue.
 * @param {Object}   data       The data to associate with this identifier.
 * @param {Function} callback   Called once the data has been added to the
 *                              queue, if the add failed the error argument is
 *                              set callback(error, result)
 * @method send
 */
Queue.prototype.send = function(identifier, data, cb) {
	if (data === null || typeof data !== 'object') {
		process.nextTick(function() { callback("Data must be an object"); });
		return;
	}

    var firstState = this.states[0];
    var firstStateQueue = this.queueName + "-" + firstState;
    var queueItemData = { id: identifier, state: firstState, data: data };
    var dataString = JSON.stringify(queueItemData);

    this.redisClient.hexists([this.hashSetName, identifier], function(err, res) {
        if (res === 0) {
            this.redisClient.multi([
                ['hset',  this.hashSetName,     identifier, dataString],
                ['lpush', firstStateQueue, identifier]
            ]).exec(function(err, res) {
                cb(err, res);
            });
        } else {
            cb(new Error("Identifier: '" + identifier + "' exists in state machine"));
        }
    }.bind(this));
};

Queue.createNewId = function() {
    return uuid.v4();
};

/**
 * Register a function to process items on the queue as they arrive.
 * Only one function can be used to process items coming from the queue.
 * Only the first registered function will be used, everything else will be
 * ignored.
 *
 * @param {Function} callback The function to call with the job data from the
 *                            queue should accept a data
 *                            argument: (data). The data is the object
 *                            sent from the client with an additional
 *                            '__reactive_job_id' property as a 'uuid'
 * @method registerProcessor
 */
Queue.prototype.registerProcessor = function(callback) {
    if (!this.registeredProcessor) {
        this.registeredProcessor = callback;
        this.isListening = true;
        this._reliablePop();
    }
};


/**
 * Notify the JobQueue that a job has been processed successfully.  The job
 * object must be identical to the job received from the queue in
 * the processor function.
 *
 * @param {Object} job        The job to set as complete
 * @param {Function} callback The callback to call when the job state change
 *                            from processing to complete has completed.
 * @method notifyJobComplete
 */
Queue.prototype.notifyJobComplete = function(job, callback) {
    this._updateJobComplete(job, callback);
};

Queue.prototype.waitQueueLength = function(callback) {
	this.redisClient.llen([this.queueName], callback);
};

/**
 * Safely updates the job status in Redis.  It atomically removes the job from
 * the processing queue and adds it to the complete queue.
 */
Queue.prototype._updateJobComplete = function(job, callback) {
    var that = this;
    var jobString = JSON.stringify(job);
    this._stateTransition(job, { from: 'processing', to: 'complete' }, function(error, results) {
        if (error) {
            callback(error);
            return;
        }

        that.availableConcurrentSlots++;
        if (that.availableConcurrentSlots === 1) {
            that.isListening = true;
            that._reliablePop();
        }

        callback(null, results);
    });
};

Queue.prototype._stateTransition = function(job, transition, callback) {
    var transitionFromQueue = this.queueName + "-" + transition.from;
    var transitionToQueue = this.queueName + "-" + transition.to;
    var jobString = JSON.stringify(job);


    this.redisClient.multi([
        ['lrem', transitionFromQueue, 0, jobString],
        ['rpush', transitionToQueue, jobString]
    ]).exec(function(error, results) {
        if (error) {
            callback(error);
            return;
        }

        callback(null, 'OK');
    });
};

Queue.prototype._reliablePop = function () {
    var that = this;

    if (this.isListening && this.registeredProcessor) {
        this.redisClient.brpoplpush([this.queueName, this.queueName + '-processing', 0], function(error, result) {

            that.availableConcurrentSlots--;
            process.nextTick(function() { that.registeredProcessor(JSON.parse(result)); });

            if (that.availableConcurrentSlots === 0) {
                that._stopProcessing();
            } else {
                process.nextTick(function() {  that._reliablePop(); });
            }

        });
    }
};

/**
 * Stop processing new jobs (this prevents the library from listening to
 * the redis queue) and is used to control the number of jobs that can be
 * processed at a time.
 */
Queue.prototype._stopProcessing = function() {
    this.isListening = false;
};

module.exports = Queue;
