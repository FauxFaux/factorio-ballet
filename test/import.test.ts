import { describe, expect, it } from 'vitest';
import { decodeUrl } from '../src/import.ts';

describe('decodeUrl', () => {
  it('decodes the persisted proc-rs URL', () => {
    const url =
      '#s0=lZK-ZmFjdG9yaW8tMi4wLjczLWFuZ2VsYm9iLTIuMC42rHJlY2lwZWxpc3RlcpGSqmJvYi1ydWJ5LTXLQAgAAAAAAA' +
      'CQmZWqYm9iLXJ1YnktNbRhc3NlbWJsaW5nLW1hY2hpbmUtMcs_8AAAAAAAAMs_8AAAAAAAAMs_8AAAAAAAAJWqYm9iLXJ1YnktNLRhc3' +
      'NlbWJsaW5nLW1hY2hpbmUtMss_8AAAAAAAAMs_8AAAAAAAAMs_8AAAAAAAAJWqYm9iLXJ1YnktM7Rhc3NlbWJsaW5nLW1hY2hpbmUtMcs' +
      '_8AAAAAAAAMs_8AAAAAAAAMs_8AAAAAAAAJW9YW5nZWxzLW9yZTctY3J5c3RhbGxpemF0aW9uLTOzYW5nZWxzLWNyeXN0YWxsaXplcss' +
      '_8AAAAAAAAMs_8AAAAAAAAMs_8AAAAAAAAJXZIWFuZ2Vscy1jcnlzdGFsLXNsdXJyeS1maWx0ZXJpbmctMrhhbmdlbHMtZmlsdHJhdGlvbi11bml0LTLLP' +
      '_AAAAAAAADLP_AAAAAAAADLP_AAAAAAAACVuWFuZ2Vscy1nZW9kZS1ibHVlLWxpcXVpZnmwYW5nZWxzLWxpcXVpZmllcss_8AAAAAAAAMs' +
      '_8AAAAAAAAMs_8AAAAAAAAJW2Ym9iLXBvbGlzaGluZy1jb21wb3VuZLdhbmdlbHMtY2hlbWljYWwtcGxhbnQtMss_8AAAAAAAAMs' +
      '_8AAAAAAAAMs_8AAAAAAAAJWyYm9iLWdyaW5kaW5nLXdoZWVstGFzc2VtYmxpbmctbWFjaGluZS0xyz_wAAAAAAAAyz_wAAAAAAAAyz' +
      '_wAAAAAAAAlbNib2ItcG9saXNoaW5nLXdoZWVstGFzc2VtYmxpbmctbWFjaGluZS0xyz_wAAAAAAAAyz_wAAAAAAAAyz_wAAAAAAAApnNlY29uZA';

    expect(decodeUrl(url)).toMatchSnapshot();
  });
});
