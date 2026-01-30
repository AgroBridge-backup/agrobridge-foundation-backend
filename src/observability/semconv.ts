import { SpanStatusCode } from '@opentelemetry/api';
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_URL_PATH,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
} from '@opentelemetry/semantic-conventions';

export const semconv = {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_URL_PATH,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  SpanStatusCode,

  // Custom attributes (stable naming for querying).
  ATTR_DB_SYSTEM: 'db.system',
  ATTR_DB_OPERATION: 'db.operation',
  ATTR_DB_MODEL: 'db.model',
  ATTR_DB_DURATION_MS: 'db.duration_ms',
};
