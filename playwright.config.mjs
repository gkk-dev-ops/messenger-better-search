export default {
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: [["line"]]
};
