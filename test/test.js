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

	describe("#set(identifier, data, callback)", function() {

		it("Should put the identifier in the first queue and insert the data into the hashset, if it does not exist yet", function(done) {
            var q = this.q;

            var hexistsSpy = sinon.spy();
            var multiSpy = sinon.spy();
            var execSpy = sinon.spy();

            var mockRedisClient = {
                hexists: function(commands, callback) {
                    hexistsSpy(commands);
                    callback(null, 0);
                },
                multi: function(commands) {
                    multiSpy(commands);
                    return {
                        exec: function(func) {
                            execSpy();
                            func(null, 1);
                        }
                    };
                }
            };

            q.redisClient = mockRedisClient;

			q.set("my-sane-id", { test: 'data' }, function(error) {
				if (error) {
					assert.fail('error', 'no error', error);
					return;
				}

                assert(hexistsSpy.calledWith(['my-sane-id', 'id']));
                assert(
                    multiSpy.calledWith([
                        ['hmset', 'my-sane-id', 'id', 'my-sane-id', 'state', 'a', 'data', JSON.stringify({ test: 'data' })],
                        ['lpush', '__q-myqueue-a', 'my-sane-id']
                    ])
                );
                assert(execSpy.called);
                done();
			});
		});

        it("Should update the data in the hashset if the identifier already exists in the state machine", function(done) {
            var q = this.q;
            var data = { test: 'foo' };

            var hexistsSpy = sinon.spy();
            var multiSpy = sinon.spy();
            var execSpy = sinon.spy();
            var hsetSpy = sinon.spy();

            var mockRedisClient = {
                hexists: function(commands, callback) {
                    hexistsSpy(commands);
                    callback(null, 1);
                },
                multi: function(commands) {
                    multiSpy(commands);
                    return {
                        exec: function(func) {
                            execSpy();
                            func(null, 1);
                        }
                    };
                },
                hset: function(commands, callback) {
                    assert.deepEqual(commands, ['my-sane-id', 'data', JSON.stringify(data)]);
                    callback(null, 1);
                }
            };

            q.redisClient = mockRedisClient;

			q.set("my-sane-id", data, function(error) {
				if (error) {
					assert.fail('error', 'no error', error);
					return;
				}

                assert(hexistsSpy.calledWith(['my-sane-id', 'id']));
                assert(multiSpy.notCalled)
                assert(execSpy.notCalled);
                done();
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

			q.set("my-sane-id", {test: 'data'}, function(error) {
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

        it('Should fire the "end" event when an item is removed from the state machine context by transitioning from:x to nothing', function(done) {
            var spy = sinon.spy();
            var q = this.q;
            q.on('transition', spy);

            q._stateTransition("my-sane-id", { from: "a" }, function(err) {
                assert(spy.called);
                assert(spy.calledWith({ id: "my-sane-id", from: "a" }));
                done();
            });
        });

        it('Should transition an identifier between two redis lists based on the transition argument', function(done) {
			var q = this.q;

            var execSpy = sinon.spy();

            q.redisClient.multi = function(commands) {
                assert.deepEqual(commands, [
                    ["lrem", "__q-myqueue-a", 0, "my-sane-id"],
                    ["rpush", "__q-myqueue-b", "my-sane-id"],
                    ["hset", "my-sane-id", "state", "b"]
                ]);

                return { exec: function(func) {
                    execSpy();
                    func(null, 1);
                }};
            };

            q._stateTransition("my-sane-id", { from: "a", to: "b" }, function(error) {
                assert(execSpy.called, "Exec not called");
                done();
            });
        });

        it("If transition.to is not existant or falsey, then remove state field from hashset", function(done) {
			var q = this.q;

            var execSpy = sinon.spy();

            q.redisClient.multi = function(commands) {
                assert.deepEqual(commands, [
                    ["lrem", "__q-myqueue-a", 0, "my-sane-id"],
                    ["hdel", "my-sane-id", "state"]
                ]);

                return { exec: function(func) {
                    execSpy();
                    func(null, 1);
                }};
            };

            q._stateTransition("my-sane-id", { from: "a" }, function(error) {
                assert(execSpy.called, "Exec not called");
                done();
            });

        });
    });

    describe("#has(identifier, callback)", function() {
        it("Should return true when an identifier exists in the state machine", function(done) {
            var q = this.q;

            q.set("my-existing-id", { some: "test" }, function() {
                q.has("my-existing-id", function(err, result) {
                    assert.equal(true, result);
                    assert.equal(null, err);
                    done();
                });
            });
        });

        it("Should return false when an identifier does not exist in the state machine", function(done) {
            var q = this.q;

            q.has("my-non-existing-id", function(err, result) {
                assert.equal(false, result);
                assert.equal(null, err);
                done();
            });
        });
    });

    describe("#get(identifier, callback)", function() {
        it("Should get the data object and the state from the hash set if the identifier exists in the state machine", function(done) {
            var q = this.q;
            var data = { test: 'foo' };

            q.set('my-insane-id', data, function() {
                q.get('my-insane-id', function(err, state, _data) {
                    assert.equal(state, 'a');
                    assert.deepEqual(_data, data);
                    done();
                });
            });
        });

        it("Should error if the identifier does not exist in the state machine", function(done) {
            var q = this.q;

            q.get('my-extrasane-id', function(err, state, _data) {
                assert(err);
                done();
            });
        });
    });

    describe("#end()", function() {
        it("Should emit an event once the redis connection has closed", function(done) {
            var q = this.q;
            var endSpy = sinon.spy();
            var eventSpy = sinon.spy();

            q.redisClient = { end: endSpy };
            q.on('close', function(event) {
                assert(endSpy.called);
                done();
            });

            q.end();
        });
    });

/*

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
