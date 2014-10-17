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

			q.set("my-sane-id", {test: 'data'}, function(error) {
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
