var redis = require('redis'),
    EventEmitter = require('events').EventEmitter,
    util = require('util'),
    uuid = require('node-libuuid');


function flatMap(array, lambda) {
    return Array.prototype.concat.apply([], array.map(lambda));
}

function keyPairs(object) {
    return flatMap(Object.keys(object), function(key) {
        return [key, object[key]];
    });
}

/**
 * Create a new Queue
 *
 * @param {String}  options.queuename           The name of the queue to connect to.
 * @param {Integer} [options.port]              The port to use to connect to the redis
 *                                              server
 * @param {String}  [options.host]              The IP address (or hostname) of the redis
 *                                              server
 * @param {Integer} [options.concurrency=1]     The number of jobs to process at any
 *                                              one time.
 * @param {Object}  [options.redis]             An instance of a redis client
 *                                              library (see node-redis for
 *                                              expected API)
 * @param {Function} stateTransitionFunction    A function that returns the next state.
 *
 * @class Queue
 * @constructor
 */
function Queue(options, stateTransitionFunction) {
    var redisPort = options.port || process.env.REDIS_PORT;
    var redisHost = options.host || process.env.REDIS_HOST;

    var redisOptions = {
        // If items can't be placed into a queue, error rather than buffer
        // them until a connection is made
        enable_offline_queue: true
    };

    this.stateTransitionFunction = stateTransitionFunction;

    this.redisClient = options.redis || redis.createClient(redisPort, redisHost, redisOptions);
    this.queueName = "__q-" + options.queuename;
    this.isListening = false;

    this.maxConcurrentJobs = options.concurrency || 1;
    this.availableConcurrentSlots = this.maxConcurrentJobs;

    this.registeredProcessor = false;
}

util.inherits(Queue, EventEmitter);

/**
 * Send a new Job to the queue.
 *
 * @param {String}   identifier The identifier to identify the data on the
 *                              queue.
 * @param {Object}   data       The data to associate with this identifier.
 * @param {Function} callback   Called once the data has been added to the
 *                              queue, if the add failed the error argument is
 *                              set callback(error, result)
 * @method set
 */
Queue.prototype.set = function(identifier, data, cb) {
	if (data === null || typeof data !== 'object') {
		process.nextTick(function() { callback("Data must be an object"); });
		return;
	}

    this.stateTransitionFunction(identifier, null, function(err, newState) {
        var firstStateQueue = this.queueName + "-" + newState;
        var queueItemData = { id: identifier, state: newState, data: JSON.stringify(data) };
        var fields = keyPairs(queueItemData);

        // The value in the hash set will always contain an id field and
        // hexists requires a key and a field.
        this.redisClient.hexists([identifier, 'id'], function(err, res) {
            if (res === 0) {
                this.redisClient.multi([
                    ['hmset',  identifier].concat(fields),
                    ['lpush', firstStateQueue, identifier]
                ]).exec(cb);
            } else {
                this.redisClient.hset([identifier, 'data', JSON.stringify(data)], cb)
            }
        }.bind(this));
    }.bind(this));
};

/**
 * Notify the JobQueue that a job has been processed successfully.  The job
 * object must be identical to the job received from the queue in
 * the processor function.
 *
 * @param {String}   identifier The identifier to transition to the next state
 * @param {Function} callback   The callback to call when the job state change
 *                              from processing to complete has completed.
 * @method done
 */
Queue.prototype.done = function(identifier, expectedState, callback) {

    this.redisClient.hexists([identifier, 'id'], function(err, res) {
        if (res === 1) {
            this.redisClient.hmget([identifier, 'id', 'state', 'data'], function(err, data) {
                var currentState = data[1];

                if (currentState !== expectedState) {
                    callback(new Error("Current state is not the expected state. identifier=" + identifier + " actualstate=" + currentState + " expectedstate=" + expectedState));
                    return;
                }

                this.stateTransitionFunction(identifier, currentState, function(err, newState) {
                    this._stateTransition(identifier, { from: currentState, to: newState }, callback);
                }.bind(this));
            }.bind(this));
        } else {
            callback(new Error("Identifier: '" + identifier + "' does not exist in state machine"));
        }
    }.bind(this));
};

/**
 * Get a boolean indicating the existence of an ID in the state machine.
 *
 * @param identifier {String}   The identifier
 * @param callback   {Function} A function accepting two arguments, error, and result, where result is a boolean
 *
 * @method has
 */
Queue.prototype.has = function(identifier, callback) {
    this.redisClient.hexists([identifier, 'id'], function(err, result) {
        if (err) {
            callback(err);
            return;
        }

        if (result === 1) {
            callback(null, true);
        } else {
            callback(null, false);
        }
    });
};

Queue.prototype.get = function(identifier, callback) {
    this.redisClient.hmget([identifier, 'state', 'data'], function(err, result) {
        if (err) {
            callback(err);
            return;
        }

        if ((result[0] === null && result[1] === null)) {
            callback(new Error("Identifier does not exist in hash set: identifier=" + identifier));
            return;
        }

        var state = result[0];
        var data = JSON.parse(result[1]);

        callback(null, state, data);
    });
};

Queue.prototype.waitQueueLength = function(state, callback) {
	this.redisClient.llen([state], callback);
};

Queue.prototype._stateTransition = function(identifier, transition, callback) {
    var redisMultiCommands = [];
    var transitionFromQueue = this.queueName + "-" + transition.from;
    redisMultiCommands.push(['lrem', transitionFromQueue, 0, identifier]);

    if (transition.to) {
        var transitionToQueue = this.queueName + "-" + transition.to;
        redisMultiCommands.push(['rpush', transitionToQueue, identifier]);
        redisMultiCommands.push(['hset', identifier, 'state', transition.to]);
    } else {
        redisMultiCommands.push(['hdel', identifier, 'state']);
    }

    this.redisClient.multi(redisMultiCommands).exec(function(err, result) {
        if (err) {
            callback(err);
        } else {
            this.emit('transition', { id: identifier, from: transition.from, to: transition.to });
            callback(null, result);
        }
    }.bind(this));
};

Queue.prototype.end = function() {
    this.redisClient.end();
};


Queue.createNewId = function() {
    return uuid.v4();
};


module.exports = Queue;
