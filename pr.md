🧪 Add edge case tests for testUrls

🎯 **What:** The testing gap addressed
This PR addresses missing edge case tests in `src/utils/http-helper.ts:63` specifically targeting `testUrls`, which lacked coverage for arrays containing empty strings or malformed URLs.

📊 **Coverage:** What scenarios are now tested
A new test block has been added to cover `testUrls` resolving properly when invoked with an array containing an empty string, an invalid URL, and a correct URL `['', 'invalid-url', 'http://success.local']`. This proves `testUrls` is resilient to potentially malformed data when using `promiseAny`.

✨ **Result:** The improvement in test coverage
The module's robustness is further validated, and its handling of edge-cases involving empty elements and bad formats within an array parameter is officially proven.
