var assert = require('assert');
var JobQueue = require('../lib');
var fakeredis = require('fakeredis');
var sinon = require('sinon');
var serialList = require('../lib/serialstates');

describe("JobQueue", function() {

    beforeEach(function() {
        this.q = new JobQueue({
            redis: fakeredis.createClient("testsend"),
            queuename: 'myqueue'
        }, serialList(['a', 'b']));
    });

	describe("#send(identifier, data, callback)", function() {

		it("Should send the identifier to the first queue and insert the data into the hashset", function(done) {
            var q = this.q;

			q.send("my-sane-id", {test: 'data'}, function(error) {
				if (error) {
					assert.fail('error', 'no error', error);
					return;
				}

				// Test in queue
				q.redisClient.rpop(['__q-myqueue-a'], function(error, data) {
					if (error) {
						assert.fail('error', 'no error', error);
						done();
						return;
					}

                    assert.equal('my-sane-id', data);

                    q.redisClient.hexists(['__hs-myqueue', 'my-sane-id'], function(error, data) {
                        assert.equal(data, 1);
                        q.redisClient.hget(['__hs-myqueue', 'my-sane-id'], function(error, data) {
                            var object = JSON.parse(data);
                            assert.equal('a', object.state);
                            assert.equal('my-sane-id', object.id);
                            assert.equal('data', object.data.test);
                            done();
                        });
                    });
				});
			});
		});
        /*
		it("Should callback with error if the job parameter is not an object", function(done) {
			var q = new JobQueue({
				redis: fakeredis.createClient("testsend"),
				queuename: 'myqueue'
			});

			q.send(null, function(error, data) {
				if (!error) {
					assert.fail("no error", "error");
					done();
					return;
				}

				done();
			});
		});
        */

	});

    describe("#done(identifier, expectedState, callback)", function() {
        it("Should transition from expectedState to the next state defined by the stateTransitionFunction", function(done) {

            var spy = sinon.spy();

			var q = this.q;

            q._stateTransition = function(identifier, state, done) {
                spy(identifier, state, done);
                done();
            };

			q.send("my-sane-id", {test: 'data'}, function(error) {
                q.done("my-sane-id", "a", function(err, result) {
                    // Test in queue
                    assert(spy.called, "Spy not called");
                    assert(spy.calledWith("my-sane-id", { from: "a", to: "b" }));
                    done();
                });
            });

        });
    });

    describe("#_stateTransition(identifier, transition, callback)", function() {
        it('Should fire the "transition" event', function(done) {
            var spy = sinon.spy();

			var q = this.q;

            q.on('transition', spy);

            q._stateTransition("my-sane-id", { from: "a", to: "b" }, function(err) {
                assert(spy.called);
                assert(spy.calledWith({ id: "my-sane-id", from: "a", to: "b"}));
                done();
            });
        });

        it('Should transition an identifier between two redis lists based on the transition argument', function() {
			var q = this.q;

            var multiSpy = sinon.spy();
            var execSpy = sinon.spy();

            q.redisClient.multi = function(commands) {
                multiSpy(commands);
                return { exec: execSpy };
            };

            q._stateTransition("my-sane-id", { from: "a", to: "b" }, function(error) {
                assert(multiSpy.called, "Multi not called");
                assert(
                    multiSpy.calledWith([
                        ["lrem", "__q-myqueue-a", 0, "my-sane-id"],
                        ["rpush", "__q-myqueue-b", "my-sane-id"]
                    ])
                );

                assert(execSpy.called, "Exec not called");
                done();
            });

        });
    });

    describe("#has(identifier, callback)", function() {
        it("Should return true when an identifier exists in the state machine", function(done) {
            var q = this.q;

            q.send("my-existing-id", { some: "test" }, function() {
                q.has("my-existing-id", function(err, result) {
                    assert.equal(true, result);
                    assert.equal(null, err);
                    done();
                });
            });
        });
    });
/*
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
			var q = new JobQueue({
				redis: fakeredis.createClient("test-registerprocessor2"),
				queuename: 'myqueue-test',
				concurrency: 2
			});

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
						redisClient.rpop("__rjq-myqueue-test", function(error, data) {
							var parsedData = JSON.parse(data);
							assert.equal("data3", parsedData.some);
							done();
						});
					});
				}
			});
		});
	});

	describe("#waitQueueLength(callback)", function() {
		it("Should receive the length of the wait queue as its callback data argument", function(done) {
			var q = new JobQueue({
				redis: fakeredis.createClient("test-waitqueuelength1"),
				queuename: 'myqueue-test'
			});

			q.send({data: "some"}, function(error, data) {
				q.waitQueueLength(function(error, data) {
					assert.equal(1, data);
					done();
				});
			});
		});
	});
*/
});
