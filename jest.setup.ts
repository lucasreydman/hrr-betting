// Suppress noisy console.log during tests; keep warn/error
const originalLog = console.log
beforeAll(() => { console.log = () => {} })
afterAll(() => { console.log = originalLog })
