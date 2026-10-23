module.exports = function (source) {
  return require('typescript').transpileModule(source, {
    compilerOptions: {
      module: require('typescript').ModuleKind.ESNext,
      target: require('typescript').ScriptTarget.ES2022,
      jsx: require('typescript').JsxEmit.ReactJSX,
    },
  }).outputText
}
