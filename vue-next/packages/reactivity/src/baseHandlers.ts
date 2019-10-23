import { reactive, readonly, toRaw } from './reactive'
import { OperationTypes } from './operations'
import { track, trigger } from './effect'
import { LOCKED } from './lock'
import { isObject, hasOwn, isSymbol } from '@vue/shared'
import { isRef } from './ref'

const builtInSymbols = new Set(
  Object.getOwnPropertyNames(Symbol)
    .map(key => (Symbol as any)[key])
    .filter(isSymbol)
)

function createGetter(isReadonly: boolean) {
  return function get(target: any, key: string | symbol, receiver: any) {
    const res = Reflect.get(target, key, receiver)
    // key 不能为symbol类型，并且对象内部部署的symbol接口也不进行侦听 (因为symbol扩展的属性一般是内置属性，例如toString()、valueOf()等 )；
    if (isSymbol(key) && builtInSymbols.has(key)) {
      return res
    }
    // 判断对象中是否被Ref包装，如果有则返回包装的值
    if (isRef(res)) {
      return res.value
    }
    // 记录响应对象
    track(target, OperationTypes.GET, key)
    // 如果这里get得到的数据是个对象，那么将该结果转换为响应式对象。这里的proxy.get本身是个惰性响应数据函数。例如：
    /*
      proxy本质只能监听对象的第一层
      const val = new Proxy({
        a: '123'
      }, handler);
      val.a = {};  handler.get 会触发
      val.a.b = 123;  不会触发，因此这里需要先检测val.a是否是对象，如果是对象，则转换为可响应数据。
      set会触发此函数
      ```
      const oldValue = target[key]
      ```
    */
    return isObject(res)
      ? isReadonly
        ? // 这里需要延迟访问只读和响应，以避免循环依赖。
          readonly(res)
        : reactive(res)
      : res
  }
}

function set(
  target: any,
  key: string | symbol,
  value: any,
  receiver: any
): boolean {
  // 查询是否已经被观测，若已经被观测，则直接返回 响应对象proxy
  value = toRaw(value)
  // 需要先触发一次get
  const oldValue = target[key]
  // TODO:
  if (isRef(oldValue) && !isRef(value)) {
    oldValue.value = value
    return true
  }
  // 判断是否是自有属性或当层原型
  const hadKey = hasOwn(target, key)
  const result = Reflect.set(target, key, value, receiver)
  // 如果修改的key目标的原型链上，则不触发trigger。由于原型链上的receiver = target的原型链上，因此不相等
  if (target === toRaw(receiver)) {
    /* istanbul ignore else */
    // 开发环境可以执行打点记录操作
    if (__DEV__) {
      const extraInfo = { oldValue, newValue: value }
      if (!hadKey) {
        trigger(target, OperationTypes.ADD, key, extraInfo)
      } else if (value !== oldValue) {
        console.log('trgger');
        trigger(target, OperationTypes.SET, key, extraInfo)
      }
    } else {
      // 没有该属性，则触发OperationTypes.ADD进行添加trigger，
      // 存在该属性，且值与原值不相等，则会触发 OperationTypes.SET 操作
      if (!hadKey) {
        trigger(target, OperationTypes.ADD, key)
      } else if (value !== oldValue) {
        trigger(target, OperationTypes.SET, key)
      }
    }
  }
  return result
}

function deleteProperty(target: any, key: string | symbol): boolean {
  const hadKey = hasOwn(target, key)
  const oldValue = target[key]
  const result = Reflect.deleteProperty(target, key)
  if (result && hadKey) {
    /* istanbul ignore else */
    if (__DEV__) {
      trigger(target, OperationTypes.DELETE, key, { oldValue })
    } else {
      trigger(target, OperationTypes.DELETE, key)
    }
  }
  return result
}

function has(target: any, key: string | symbol): boolean {
  const result = Reflect.has(target, key)
  track(target, OperationTypes.HAS, key)
  return result
}

function ownKeys(target: any): (string | number | symbol)[] {
  track(target, OperationTypes.ITERATE)
  return Reflect.ownKeys(target)
}

export const mutableHandlers: ProxyHandler<any> = {
  get: createGetter(false),
  set,
  deleteProperty,
  has,
  ownKeys
}

export const readonlyHandlers: ProxyHandler<any> = {
  get: createGetter(true),

  set(target: any, key: string | symbol, value: any, receiver: any): boolean {
    if (LOCKED) {
      if (__DEV__) {
        console.warn(
          `Set operation on key "${String(key)}" failed: target is readonly.`,
          target
        )
      }
      return true
    } else {
      return set(target, key, value, receiver)
    }
  },

  deleteProperty(target: any, key: string | symbol): boolean {
    if (LOCKED) {
      if (__DEV__) {
        console.warn(
          `Delete operation on key "${String(
            key
          )}" failed: target is readonly.`,
          target
        )
      }
      return true
    } else {
      return deleteProperty(target, key)
    }
  },

  has,
  ownKeys
}
