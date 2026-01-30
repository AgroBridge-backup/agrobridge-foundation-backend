local key = KEYS[1]
local max_requests = tonumber(ARGV[1])
local time_window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local count = tonumber(redis.call('HGET', key, 'count') or 0)
local reset_time = tonumber(redis.call('HGET', key, 'resetTime') or 0)

if reset_time < now then
    count = 0
    reset_time = now + time_window
    redis.call('HSET', key, 'count', 0)
    redis.call('HSET', key, 'resetTime', reset_time)
    
    local ttl_ms = reset_time - now
    if ttl_ms > 0 then
        redis.call('PEXPIRE', key, ttl_ms)
    end
end

local allowed = count < max_requests
if allowed then
    count = count + 1
    
    if count > 9007199254740991 then
        count = 1
    end
    
    redis.call('HSET', key, 'count', count)
end

return { allowed, count, max_requests, reset_time }
