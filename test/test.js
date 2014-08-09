var assert = require('assert');
var JobQueue = require('../lib');
var fakeredis = require('fakeredis');

describe("JobQueue", function() {

	describe("#send(job, callback)", function() {
		var q = new JobQueue({
			redis: fakeredis.createClient("test"),
			queuename: 'myqueue'
		});

		it("Should send the job data to the queue", function() {

			q.send({test: 'data'}, function(error, data) {
				if (error) {
					assert.fail('error', 'no error', error);
					return;
				}

				// Test in queue
				q.redisClient.rpop(['myqueue'], function(error, data) {
					if (error) {
						assert.fail('error', 'no error', error);
						return;
					}

					assert.equal(data.test, 'data');
				});
			});
		});

		it("Should callback with error if the job parameter is not an object", function() {
			q.send(null, function(error, data) {
				if (!error) {
					assert.fail("no error", "error");
					return;
				}
			});
		});
	});
});
