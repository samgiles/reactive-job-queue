# Reactive Job Queue

A Reactive job queue backed by Redis.  This Job queue provides guarantees
(as much as Redis can provide) about the loss of job data. The job state
atomically changes in the database from `queued`, to `processing` to
`complete` so the data is always available in the database.

#### Get Started

`npm install reactive-job-queue`

These examples assume you have a Redis server running on localhost on the
standard port.  You can configure `port` and `host` using the constructor, or
the constructor will pick up the values in the `REDIS_PORT` and `REDIS_HOST`
environment variables.

If you have [docker](https://docker.com) installed, you can `source activate_docker.sh` to start a
Redis server in a docker instance and set up the appropriate `REDIS_PORT` and
`REDIS_HOST` environment variables automatically.

Example: Producer

```JS
var JobQueue = require('reactive-job-queue');

var q = new JobQueue({ queuename: 'myjobqueue', port: 6379, host: '0.0.0.0' });
q.send({"name": "test", "job": "data"}, function(error, result) {
	if (error) {
		// Should re-send or handle, if there was not an error.
		// the data was added to the queue and it is safe to continue
	}
});

```

Example: Consumer/Job processor

```JS
var JobQueue = require('reactive-job-queue');

var q = new JobQueue({ queuename: 'myjobqueue', port: 6379, host: '0.0.0.0' });

q.registerProcessor(function(data) {
	yourProcessDataFunction(data, function(error, complete) {
		if (!error) {
			q.notifyJobComplete(data, function(error, data) {
				if (!error) {
					console.log("Processing complete!");
				}
			});
		}
	});
});
```

# API

### new ReactiveJobQueue(options)

Creates a new ReactiveJobQueue.

- `options` - (Object) Settings for this Job Queue, must be set as some
              members are mandatory
  - `queuename` - (String) The name of the queue to put/receive jobs to/from.
  - `port`      - (Integer|Optional) The redis port to connect to (uses env var `REDIS_PORT` if not set).
  - `host`      - (String|Optional) The port or hostname of the redis server (uses env var `REDIS_HOST` if not set).
  - `concurrency` - (Integer|Optional) The number of jobs to process at any time.
  - `redis`       - (Object|Optional) The instance of the redis client to use.

### send(job, callback)

Send a new Job to the queue.

- `job`      - (Object) the job to send to the queue as an object.
- `callback` - (Function) called once the data has been added to the queue, if
  the addition of the data failed the error argument is set. Takes two
  arguments: (error, result)

### registerProcessor(callback)

Register a function to process items on the queue as they arrive. Only one
function can be used to process items coming from the queue. Only the first
registered function will be used, everything else will be ignored.

- `callback` - (Function) the function to call with the job data from the queue.  This
  should accept a data argument: (data).  The data is the
  object sent from the client with an additional `__reactive_job_id` property
  as a 'uuid'.

### notifyJobComplete(job, callback)

Notify the job queue that a job has been processed successfully.  The job
object must be identical to the job received from the queue in the processor
function.

- `job`  - (Object) the job to move into the complete state
- `callback` - (Function) the callback to call when this operation completes.

# TODO

- Promises API
- Provide more generic job state transition.
- Provide mechanisms to recover jobs from each state.

# License

Samuel Giles - MIT Licensed
