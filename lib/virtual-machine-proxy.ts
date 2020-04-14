import * as VM from './virtual-machine';
import { mapObject, notImplemented, assertUnreachable, assert, invalidOperation, notUndefined } from './utils';
import { Snapshot } from './snapshot';

export interface Globals {
  [name: string]: any;
}

const hostFunctionIDs = new Map<Function, VM.HostFunctionID>();

export class VirtualMachineWithMembrane {
  private vm: VM.VirtualMachine;

  constructor (globals: Globals, opts: VM.VirtualMachineOptions = {}) {
    const proxiedGlobals = mapObject(globals, createGlobal);
    this.vm = VM.VirtualMachine.create(proxiedGlobals, opts);
  }

  public async importFile(filename: string) {
    return notImplemented();
  }

  public importModuleSourceText(sourceText: string, sourceFilename: string) {
    // TODO: wrap result and return it
    // TODO: modules shouldn't return their module object, since this doesn't work for cyclic dependencies
    const result = this.vm.importModuleSourceText(sourceText, sourceFilename);
  }

  public createSnapshot(): Snapshot {
    return this.vm.createSnapshot();
  }

  public exportValue(exportID: VM.ExportID, value: any) {
    const vmValue = hostValueToVM(this.vm, value);
    this.vm.exportValue(exportID, vmValue);
  }

  public garbageCollect() {
    this.vm.garbageCollect();
  }
}

export function giveHostFunctionAPersistentID<T extends Function>(hostFunctionID: VM.HostFunctionID, func: T): T {
  hostFunctionIDs.set(func, hostFunctionID);
  return func;
}

// TODO: Deprecate this in favor of `new VirtualMachineWithMembrane`
export function createVirtualMachine(globals: Globals, opts: VM.VirtualMachineOptions = {}): VM.VirtualMachine {
  const proxiedGlobals = mapObject(globals, createGlobal);
  return VM.VirtualMachine.create(proxiedGlobals, opts);
}

function createGlobal(value: any, name: string): VM.GlobalDefinition {
  return vm => hostValueToVM(vm, value, name);
}

function hostFunctionToVM(vm: VM.VirtualMachine, func: Function): VM.HostFunctionHandler {
  return (object, args) => {
    const result = func.apply(vmValueToHost(vm, object), args.map(a => vmValueToHost(vm, a)));
    return hostValueToVM(vm, result);
  }
}

function vmValueToHost(vm: VM.VirtualMachine, value: VM.Value): any {
  switch (value.type) {
    case 'BooleanValue':
    case 'NumberValue':
    case 'UndefinedValue':
    case 'StringValue':
    case 'NullValue':
      return value.value;
    case 'FunctionValue':
      return new Proxy<any>(dummyFunctionTarget, new ValueWrapper(vm, value));
    case 'HostFunctionValue': return notImplemented();
    case 'EphemeralFunctionValue': return notImplemented();
    case 'ReferenceValue': return notImplemented();
    default: return assertUnreachable(value);
  }
}

function hostValueToVM(vm: VM.VirtualMachine, value: any, nameHint?: string): VM.Anchor<VM.Value> {
  switch (typeof value) {
    case 'undefined': return vm.createAnchor(vm.undefinedValue);
    case 'boolean': return vm.createAnchor(vm.booleanValue(value));
    case 'number': return vm.createAnchor(vm.numberValue(value));
    case 'string': return vm.createAnchor(vm.stringValue(value));
    case 'function': {
      if (hostFunctionIDs.has(value)) {
        const hostFunctionID = hostFunctionIDs.get(value)!;
        return vm.registerHostFunction(hostFunctionID, hostFunctionToVM(vm, value));
      }
      if (ValueWrapper.isWrapped(vm, value)) {
        return vm.createAnchor(ValueWrapper.unwrap(vm, value));
      } else {
        return vm.ephemeralFunction(hostFunctionToVM(vm, value), nameHint || value.name);
      }
    }
    case 'object': {
      if (value === null) {
        return vm.createAnchor(vm.undefinedValue);
      }
      if (ValueWrapper.isWrapped(vm, value)) {
        return vm.createAnchor(ValueWrapper.unwrap(vm, value));
      } else {
        return notImplemented();
      }
    }
    default: return notImplemented();
  }
}

// Used as a target for function proxies, so that `typeof` and `call` work as expected
const dummyFunctionTarget = () => {};

const vmValueSymbol = Symbol('vmValue');
const vmSymbol = Symbol('vm');

export class ValueWrapper implements ProxyHandler<any> {
  constructor (
    private vm: VM.VirtualMachine,
    private vmValue: VM.Value // TODO: ownership, WeakRef
  ) {
  }

  static isWrapped(vm: VM.VirtualMachine, value: any): boolean {
    return (typeof value === 'function' || typeof value === 'object') &&
      value !== null &&
      value[vmValueSymbol] &&
      value[vmSymbol] == vm // It needs to be a wrapped value in the context of the particular VM in question
  }

  static unwrap(vm: VM.VirtualMachine, value: any): VM.Value {
    assert(ValueWrapper.isWrapped(vm, value));
    return value[vmValueSymbol];
  }

  get(_target: any, p: PropertyKey, receiver: any): any {
    if (p === vmValueSymbol) return this.vmValue;
    if (p === vmSymbol) return this.vm;
    if (typeof p !== 'string') return invalidOperation('Only string properties supported');
    if (this.vmValue.type !== 'ReferenceValue') return invalidOperation('Accessing property or index on non-object/non-array')
    const allocation = this.vm.dereference(this.vmValue);
    if (allocation.type === 'ArrayAllocation' && p !== 'length') {
      const index = parseInt(p);
      if (isNaN(index)) return invalidOperation('Invalid array accessor');
      const value = this.vm.arrayGet(allocation, index);
      return vmValueToHost(this.vm, value);
    } else {
      const value = this.vm.objectGet(allocation, p);
      return vmValueToHost(this.vm, value);
    }
  }

  set(_target: any, p: PropertyKey, value: any, receiver: any): boolean {
    return notImplemented();
  }

  apply(_target: any, thisArg: any, argArray: any[] = []): any {
    return notImplemented();
  }
}