// Keep dependency tracing inside this application rather than the parent user's lockfile.
export default {
  outputFileTracingRoot: process.cwd(),
  // A production build must not overwrite the running development server's routes/CSS.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  logging: { incomingRequests: { ignore: [/^\/auth\/callback(?:\?|$)/] } },
}
