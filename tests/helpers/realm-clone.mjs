import {MessageChannel,moveMessagePortToContext,receiveMessageOnPort} from "node:worker_threads";

// Uses V8's real structured serializer and deserializes into the target VM
// realm. This is not browser MessagePort/structuredClone acceptance.
export function cloneIntoContext(context,value){
  const {port1,port2}=new MessageChannel();
  const moved=moveMessagePortToContext(port2,context);
  try{
    port1.postMessage(value);
    const received=receiveMessageOnPort(moved);
    if(!received)throw new Error("Native clone message not available");
    return received.message;
  }finally{port1.close();moved.close();}
}
export function withNativeClone(context){
  context.structuredClone=value=>cloneIntoContext(context,value);
}
