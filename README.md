# Reactive Job Queue

A Reactive Queue API backed by Redis.


# API

### new ReactiveJobQueue(options)

Creates a new ReactiveJobQueue.

- `options` - (Object) Settings for this Job Queue, must be set as some
              members are mandatory
  - `queuename` - (String) The name of the queue to put/receive jobs to/from.
  - `port`      - (Integer|Optional) The redis port to connect to.
  - `host`      - (String) The port or hostname of the redis server.
  - `concurrency` - (Integer) The number of jobs to process at ay time.

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
  should accept an error and a data argument: (error, data).  The data is the
  object sent from the client with an additional `__reactive_job_id` property
  as a 'uuid'.

### notifyJobComplete(job, callback)

Notify the job queue that a job has been processed successfully.  The job
object must be identical to the job received from the queue in the processor
function.

- `job`  - (Object) the job to move into the complete state
- `callback` - (Function) the callback to call when this operation completes.
