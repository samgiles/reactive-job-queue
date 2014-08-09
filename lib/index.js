var redis = require('redis'),
    uuid = require('node-libuuid');

/**
 * Create a new ReactiveJobQueue
 *
 * @param {String}  options.queuename       The name of the queue to connect to.
 * @param {Integer} [options.port]          The port to use to connect to the redis
 *                                          server
 * @param {String}  [options.host]          The IP address (or hostname) of the redis
 *                                          server
 * @param {Integer} [options.concurrency=1] The number of jobs to process at any
 *                                          one time.
 * @class ReactiveJobQueue
 * @constructor
 */
function ReactiveJobQueue(options) {
    var redisPort = options.port || process.env.REDIS_PORT;
    var redisHost = options.host || process.env.REDIS_HOST;

    var redisOptions = {
        // If items can't be placed into a queue, error rather than buffer
        // them until a connection is made
        enable_offline_queue: true
    };

    this.redisClient = redis.createClient(redisPort, redisHost, redisOptions);
    this.queueName = options.queuename;
    this.processingQueueName = options.queuename + '-processing';
    this.resultQueueName = options.queuename + '-complete';
    this.isListening = false;

    this.maxConcurrentJobs = options.concurrency || 1;
    this.availableConcurrentSlots = this.maxConcurrentJobs;

    this.registeredProcessor = false;
}

/**
 * Send a new Job to the queue.
 *
 * @param {Object} job        The data to put onto the queue.
 * @param {Function} callback Called once the data has been added to the
 *                            queue, if the add failed the error argument is
 *                            set callback(error, result)
 * @method send
 */
ReactiveJobQueue.prototype.send = function(job, callback) {
    job.__reactive_job_id = uuid.v4();
    var jobString = JSON.stringify(job);
    this.redisClient.lpush([this.queueName, jobString], callback);
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
ReactiveJobQueue.prototype.registerProcessor = function(callback) {
    if (!this.registeredProcessor) {
        this.registeredProcessor = callback;
        this.isListening = true;
        this._reliablePop();
    }
};

/**
 * Stop processing new jobs (this prevents the library from listening to
 * the redis queue) and is used to control the number of jobs that can be
 * processed at a time.
 */
ReactiveJobQueue.prototype._stopProcessing = function() {
    this.isListening = false;
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
ReactiveJobQueue.prototype.notifyJobComplete = function(job, callback) {
    this._updateJobComplete(job, callback);
};

/**
 * Safely updates the job status in Redis.  It atomically removes the job from
 * the processing queue and adds it to the complete queue.
 */
ReactiveJobQueue.prototype._updateJobComplete = function(job, callback) {
    var that = this;
    var jobString = JSON.stringify(job);
    this.redisClient.multi([
        ['lrem', this.processingQueueName, 1, jobString],
        ['rpush', this.resultQueueName, jobString]
    ]).exec(function(error, results) {
    if (error) {
        callback(error);
        return;
    }

    that.availableConcurrentSlots++;
    if (that.availableConcurrentSlots === 1) {
        that.isListening = true;
        that._reliablePop();
    }

    callback(null, 'OK');
    });
};

ReactiveJobQueue.prototype._reliablePop = function () {
    var that = this;

    if (this.isListening && this.registeredProcessor) {
        this.redisClient.brpoplpush([this.queueName, this.processingQueueName, 0], function(error, result) {

            this.availableConcurrentSlots--;
            process.nextTick(function() { that.registeredProcessor(JSON.parse(result)); });

            if (this.availableConcurrentSlots === 0) {
                this._stopProcessing();
            } else {
                process.nextTick(function() {  that._reliablePop(); });
            }

        });
    }
};

module.exports = ReactiveJobQueue;
