var assert = require('assert');
var JobQueue = require('../lib');
var fakeredis = require('fakeredis');
var sinon = require('sinon');

describe("JobQueue", function() {

	describe("#send(job, callback)", function() {

		it("Should send the job data to the queue", function() {
			var q = new JobQueue({
				redis: fakeredis.createClient("testsend"),
				queuename: 'myqueue'
			});

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

					assert.equal('data', JSON.parse(data).test);
				});
			});
		});

		it("Should callback with error if the job parameter is not an object", function() {
			var q = new JobQueue({
				redis: fakeredis.createClient("testsend"),
				queuename: 'myqueue'
			});

			q.send(null, function(error, data) {
				if (!error) {
					assert.fail("no error", "error");
					return;
				}
			});
		});

	});

	describe("#registerProcessor(processor)", function() {

		it("Should only register the first processor registered", function() {
			var q = new JobQueue({
				redis: fakeredis.createClient("test-registerprocessor0"),
				queuename: 'myqueue'
			});
			var mockProcessorA = function() { console.log("A"); };
			var mockProcessorB = function() { console.log("B"); };

			q.registerProcessor(mockProcessorA);
			q.registerProcessor(mockProcessorB);

			assert.equal(q.registeredProcessor, mockProcessorA);
		});

		it("Should begin receiving sent job data", function(done) {
			var q = new JobQueue({
				redis: fakeredis.createClient("test-registerprocessor1"),
				queuename: 'myqueue-test'
			});

			q.send({some: "data"}, function(error, data) {
				if (error) {
					assert.fail("error", "no error");
					done();
				}
			});

			/// Must Send before register for fakeredis to work properly..
			q.registerProcessor(function(data) {
				assert.equal("data", data.some);
				done();
			});
		});

		it("Should only receive as many jobs concurrently as specified in the constructor", function(done) {
			this.timeout(100000);
			var q = new JobQueue({
				redis: fakeredis.createClient("test-registerprocessor2"),
				queuename: 'myqueue-test',
				concurrency: 2
			});

			var spy = sinon.spy();


			q.send({some: "data1"}, function(error, data) {
				if (error) {
					assert.fail("error", "no error");
					done();
				}
			});

			q.send({some: "data2"}, function(error, data) {
				if (error) {
					assert.fail("error", "no error");
					done();
				}
			});

			q.send({some: "data3"}, function(error, data) {
				if (error) {
					assert.fail("error", "no error");
					done();
				}
			});

			var receivedData1 = false;
			var receivedData2 = false;

			var redisClient = q.redisClient;
			q.registerProcessor(function(data) {
				if (data.some === 'data1') {
					receivedData1 = true;
				} else if (data.some === 'data2') {
					receivedData2 = true;
				} else {
					assert.fail(data, "should not of received value");
					done();
				}

				if (receivedData2 && receivedData1) {
					process.nextTick(function() {
						redisClient.rpop("myqueue-test", function(error, data) {
							var parsedData = JSON.parse(data);
							assert.equal("data3", parsedData.some);
							done();
						});
					});
				}
			});
		});
	});
});
