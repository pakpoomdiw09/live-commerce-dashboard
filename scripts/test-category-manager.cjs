const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
test('category modal creates, edits and deletes with refreshed options and retains failed input',async()=>{
 const states=[];let cursor=0,tree,fail=false,confirmations=0
 const calls=[],props={categories:[],busy:false,canManage:true,async mutate(action,value,id){
  calls.push({action,value,id});if(fail)return null
  if(action==='category_delete')props.categories=props.categories.filter(c=>c.id!==id)
  else props.categories=[...props.categories.filter(c=>c.id!==id),{id:id??'new-id',name:value.name}]
  return id??'new-id'
 }}
 const jsx=(type,props)=>({type,props}),react={useEffect(){},useRef(){const i=cursor++;if(!(i in states))states[i]={current:null};return states[i]},useState(initial){const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v]}}
 const api={}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/shop/CategoryManager.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:api,document:{body:{}},confirm:()=>{confirmations++;return true},require:name=>{
  if(name==='react')return react
  if(name==='react/jsx-runtime')return {jsx,jsxs:jsx}
  if(name==='react-dom')return {createPortal:node=>node}
  return new Proxy({},{get:(_,key)=>key})
 }})
 const all=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(all):[node,...all(node.props?.children)]
 const render=()=>{cursor=0;tree=api.CategoryManager(props)}
 const nodes=()=>all(tree),flush=()=>new Promise(resolve=>setImmediate(resolve))
 const fill=value=>{nodes().find(n=>n.type==='input').props.onChange({target:{value}});render()}
 const submit=async()=>{nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await flush();render()}
 render();nodes().find(n=>n.type==='button').props.onClick();render()
 fill('New category');await submit()
 assert.equal(props.categories[0].name,'New category');assert.equal(nodes().find(n=>n.type==='input').props.value,'')
 nodes().find(n=>n.props?.['aria-label']==='แก้ไขหมวดหมู่ New category').props.onClick();render()
 assert.equal(nodes().find(n=>n.type==='input').props.value,'New category')
 fill('Renamed');await submit();assert.equal(props.categories[0].name,'Renamed');assert.equal(calls.at(-1).id,'new-id')
 fail=true;fill('Keep this draft');await submit()
 assert.equal(nodes().find(n=>n.type==='input').props.value,'Keep this draft');assert.ok(nodes().some(n=>n.props?.role==='alert'))
 fail=false
 await nodes().find(n=>n.props?.['aria-label']==='ลบหมวดหมู่ Renamed').props.onClick();await flush();render()
 assert.equal(confirmations,1);assert.equal(props.categories.length,0);assert.equal(calls.at(-1).action,'category_delete')
 props.canManage=false;render();const before=calls.length
 await submit();assert.equal(calls.length,before)
})
