import { NativeVMFriendly } from "../../lib/native-vm-friendly";
import { compileJs } from "../common"
import { assert } from 'chai'

suite('async-host-func', function () {
  /*
  An asynchronous host function can be called in one of 3 ways:

    - void-call: it's called but the resulting "promise" is elided because it's
      not accessed
    - await-call: it's called using CPS-style, so the resulting promise is
      elided because the callback is used instead.
    - expression call: it's called as part of a normal expression and so the
      resulting promise is synthesized by `mvm_asyncStart` (not implemented at
      the time of this writing).
  */

  test('void-call', () => {
    const snapshot = compileJs`
      const asyncHostFunc = vmImport(0);
      vmExport(0, () => {
        // This is a void-call (promise result not used and so is elided)
        asyncHostFunc();
      })
      vmExport(1, Microvium.noOpFunction);
      vmExport(2, (a, b) => a === b);
    `

    let callback: any;
    const asyncHostFunc = () => {
      callback = vm.asyncStart();
    }

    const vm = new NativeVMFriendly(snapshot, { 0: asyncHostFunc });
    const entry = vm.resolveExport(0);
    const noOpFunction = vm.resolveExport(1);
    const vmIsEqual = vm.resolveExport(2);
    entry();
    // Because the async host function is being void-called, we expect the
    // callback to actually be the no-op function since nothing needs to be
    // called back. Note that I'm using an exported isEqual function because
    // identity is not preserved across the membrane at this stage.
    assert(vmIsEqual(callback, noOpFunction));

    // Just for completeness - the async host function is "required" to call the
    // callback exactly once, so I'm doing it here, even though this should be a
    // no-op call. Among other things, this tests that the host can safely call
    // the noOpFunction directly.
    callback();
  })

  test('await-call', () => {
    const snapshot = compileJs`
      const asyncHostFunc = vmImport(0);
      const print = vmImport(1);
      vmExport(0, run)
      async function run() {
        print('Before await');
        // This is an await-call (promise result is elided in place of a continuation)
        await asyncHostFunc();
        print('After await');
        // WIP: also need to test return value
      }
    `

    let callback: any;
    const printout: string[] = [];

    function asyncHostFunc() {
      callback = vm.asyncStart();
    }

    function print(s: string) {
      printout.push(s);
    }

    const vm = new NativeVMFriendly(snapshot, { 0: asyncHostFunc, 1: print });
    const run = vm.resolveExport(0);

    run();
    // Continuation has not yet executed
    assert.equal(printout.join(), 'Before await');
    // Call the continuation
    callback(true, undefined);
    assert.equal(printout.join(), 'Before await,After await');
  })
})