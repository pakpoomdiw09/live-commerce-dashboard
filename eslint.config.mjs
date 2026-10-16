import {FlatCompat} from '@eslint/eslintrc'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import typescriptPlugin from '@typescript-eslint/eslint-plugin'
const compat=new FlatCompat({baseDirectory:path.dirname(fileURLToPath(import.meta.url))})
export default [
 {ignores:['.next/**','.next-dev/**','node_modules/**','scripts/**']},
 ...compat.extends('next/core-web-vitals'),
 {plugins:{'@typescript-eslint':typescriptPlugin}},
]
