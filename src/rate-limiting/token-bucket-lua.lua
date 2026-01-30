local key = KEYS[1]
local rate = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local tokens_requested = tonumber(ARGV[3])
local now = tonumber(ARGV[4])

local tokens = tonumber(redis.call('HGET', key, 'tokens') or capacity)
local last_refill = tonumber(redis.call('HGET', key, 'last_refill') or now)

local elapsed = now - last_refill
local refill = elapsed * rate / 1000
tokens = math.min(capacity, tokens + refill)

local allowed = 0
if tokens >= tokens_requested then
    allowed = 1
    tokens = tokens - tokens_requested
    
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
    redis.call('PEXPIRE', key, math.ceil(capacity / rate * 1000 * 2))
else
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
    redis.call('PEXPIRE', key, math.ceil(capacity / rate * 1000 * 2))
end

return {allowed, tokens, capacity - tokens}
