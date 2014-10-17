module.exports = function(states) {
    return function(id, state, done) {
        if (!state) {
            done(null, states[0]);
        } else {
            done(null, states[states.indexOf(state) + 1]);
        }
    };
};
