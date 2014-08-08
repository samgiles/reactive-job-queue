#!/usr/bin/env sh

docker build -t ${USER}/redis .
docker run -d -P --name redis ${USER}/redis

export REDIS_PORT=`docker port redis 6379 | sed s,0.0.0.0:,,`
export REDIS_HOST=`docker port redis 6379 | sed -E s,:.*$,,`

echo "Redis started in Docker instance (see 'docker ps -a')"
echo "\n"
echo "Environment variable REDIS_PORT has been set. Use this port on localhost"
echo "to connect to the Redis instance"
