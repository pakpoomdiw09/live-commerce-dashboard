export const usePathname = () => new URLSearchParams(window.location.search).get('path') || '/overview'
export const useRouter = () => ({ refresh() {}, push() {}, replace() {} })
