/**
Get callsites from the V8 stack trace API.

@returns An array of `CallSite` objects.

@example
```
import callsites from 'callsites';

function unicorn() {
	console.log(callsites()[0].getFileName());
	//=> '/Users/sindresorhus/dev/callsites/test.js'
}

unicorn();
```
*/
export default function callsites(): NodeJS.CallSite[] | undefined {
  const _prepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, stack) => stack;
  const stack = new Error().stack?.slice(1) as unknown;
  Error.prepareStackTrace = _prepareStackTrace;

  return stack as NodeJS.CallSite[] | undefined;
}
