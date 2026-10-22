export type LocalModelKind='speech'|'text';
export interface ModelFile {path:string;bytes:number;sha256?:string;}
export interface LocalModel {
  id:string;kind:LocalModelKind;name:string;repo:string;revision:string;
  description:string;memory:string;files:ModelFile[];
}
const whisperFiles=(encoder:number,decoder:number,encoderHash:string,decoderHash:string):ModelFile[]=>[
  {path:'config.json',bytes:2300},{path:'generation_config.json',bytes:3900},
  {path:'preprocessor_config.json',bytes:339},{path:'tokenizer_config.json',bytes:282683},
  {path:'tokenizer.json',bytes:2480466},{path:'normalizer.json',bytes:52666},
  {path:'special_tokens_map.json',bytes:2194},
  {path:'onnx/encoder_model_quantized.onnx',bytes:encoder,sha256:encoderHash},
  {path:'onnx/decoder_model_merged_quantized.onnx',bytes:decoder,sha256:decoderHash},
];
const textFiles=(size:number,hash:string):ModelFile[]=>[
  {path:'config.json',bytes:900},{path:'generation_config.json',bytes:242},
  {path:'tokenizer_config.json',bytes:7849},{path:'tokenizer.json',bytes:7031673},
  {path:'special_tokens_map.json',bytes:613},
  {path:'onnx/model_quantized.onnx',bytes:size,sha256:hash},
];
// Multilingual checkpoints (never the English-only .en variants). Revisions and
// weight hashes are pinned so an upstream update cannot silently replace a model.
export const LOCAL_MODELS:readonly LocalModel[]=[
  {id:'whisper-tiny',kind:'speech',name:'Whisper Tiny · 最省空间',repo:'Xenova/whisper-tiny',revision:'5332fcc35e32a33b86612b9a57a89be7906102b1',description:'适合安静环境、短句和设备试运行；嘈杂课堂更容易误听。',memory:'建议至少 4 GB 设备内存；前台运行',files:whisperFiles(10124910,30727765,'fd9d995b9dcb0520f0dbf6cf68651af639fc385f594d9d876e69ca2802dc438e','6c0c125986b007d2e3734bec84c18bda0152071b90b87fadac6d7764499927a0')},
  {id:'whisper-base',kind:'speech',name:'Whisper Base · 轻量均衡',repo:'Xenova/whisper-base',revision:'64da57285918e20ea79ea5c88eed7197933abaa8',description:'手机本地模式的起点；支持中、英、法，实际速度取决于设备。',memory:'建议至少 4 GB 设备内存；不保证实时速度',files:whisperFiles(23200850,53707539,'3e345e977b55620a37c0c2b2af0644e019afdfad562dcf71eb929bb7274285f9','a6beb6baabb66f00b6a686d828c95ffca6146d51900cbad0266cad38f64cf861')},
  {id:'whisper-small',kind:'speech',name:'Whisper Small · 较大模型',repo:'Xenova/whisper-small',revision:'2d67713f236afa48a18992566e7647f6ca848e13',description:'更占内存、处理更慢，适合较强设备或课后导入；先试运行再用于长课。',memory:'建议至少 8 GB 设备内存',files:whisperFiles(92324809,156780950,'969f5ac12974340386bf7a02ea6626003e5e2dee396ffc6ab0eec282bf55ba06','fcfc6100dc7339e7507e10f8b274350be7c4f8d8b575f0293f94cc0e156d6d24')},
  {id:'qwen-text-0.5b',kind:'text',name:'Qwen2.5 0.5B · 轻量体验',repo:'onnx-community/Qwen2.5-0.5B-Instruct',revision:'22942cb7d7ba4cc81bb4673549ca4d4614469b5e',description:'占用较小，但法语翻译和结构化笔记可能有明显错误；正式课程建议更大文字模型或在线服务。',memory:'建议至少 6 GB 设备内存；与语音模型轮换加载',files:textFiles(512096557,'41834041ab1b29eff9fc592f1a29a1844133aea35832ea9fa91682be13016100')},
  {id:'qwen-text-1.5b',kind:'text',name:'Qwen2.5 1.5B · 更大文字模型',repo:'onnx-community/Qwen2.5-1.5B-Instruct',revision:'d54957e3af1be04546436e874a60fe386041b244',description:'更占内存，适合电脑或较强设备；手机可能无法加载。',memory:'建议至少 8 GB 设备内存；可能明显慢于在线服务',files:textFiles(1578954293,'ee8364373c6fb35644c67fd8127cbee6c3d98ac889f8bb32ea4ac04a29650787')},
];
export function localModel(id:string):LocalModel{
  const model=LOCAL_MODELS.find(m=>m.id===id);if(!model)throw new Error('请选择列表中的本地模型。');return model;
}
export const modelBytes=(model:LocalModel):number=>model.files.reduce((n,f)=>n+f.bytes,0);
export const modelSize=(model:LocalModel):string=>`${Math.ceil(modelBytes(model)/1024/1024)} MB`;
export function modelRequest(url:string):{model:LocalModel;file:ModelFile}|null{
  const u=new URL(url);if(u.origin!=='https://huggingface.co'||u.search||u.hash)return null;
  for(const model of LOCAL_MODELS){const prefix=`/${model.repo}/resolve/${model.revision}/`;if(!u.pathname.startsWith(prefix))continue;const file=model.files.find(f=>f.path===u.pathname.slice(prefix.length));if(file)return{model,file};}
  return null;
}
