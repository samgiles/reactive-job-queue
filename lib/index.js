var redis = require('redis'),
    EventEmitter = require('events').EventEmitter;

function ReactiveJobQueue(options) {
    var redisPort = options.port || process.env.REDIS_PORT;
    var redisHost = options.host || process.env.REDIS_HOST;

    var redisOptions = {
        // If items can't be placed into a queue, error rather than buffer
        // them until a connection is made
        enable_offline_queue: true
    };

    this.redisClient = redis.createClient(redisPort, redisHost, redisOptions);
    this.eventEmitter = new EventEmitter();
    this.queueName = options.queueName;
    this.processingQueueName = options.queueName + '-processing';
    this.isListening = false;
}

ReactiveJobQueue.prototype.send = function(job, callback) {
    var jobString = JSON.stringify(job);
    this.redisClient.rpush([this.queueName, jobString], callback);
};

ReactiveJobQueue.prototype.onMessage = function(callback) {
    this.eventEmitter.on('message', callback);

    if (!this.isListening) {
        this._reliablePop();
    }
};

ReactiveJobQueue.prototype._reliablePop = function () {
    var eventEmitter = this.eventEmitter;
    var that = this;
    this.isListening = true;

    this.redisClient.brpoplpush([this.queueName, this.processingQueueName, 0], function(error, result) {

        var hadListeners = eventEmitter.emit('message', error, result);

        // There were no listeners to handle the queue item, push back to the
        // queue somehow?
        if (!hadListeners) {
            this.isListening = false;
            return;
        }

        process.nextTick(function() {  that._reliablePop(); });
    });
};

var client = new ReactiveJobQueue({ queueName: "chrome/36.0.1985" });

if (process.argv.indexOf('client') > -1) {
    console.log("Consumer");
    client.onMessage(function(error, data) {
        console.log(error || data);
    });

    var seconds = 1;
    setInterval(function() {
        console.log("I'm doing other stuff: seconds elapsed: ", seconds);
        seconds++;
    }, 1000);

} else {
    console.log("Producer");
    setInterval(function() {
        client.send({a: "job"}, function(error, data) {
            console.log(error || data);
        });
    }, 1000);
}
