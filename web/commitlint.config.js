export default {
  extends: ["@commitlint/config-conventional"],
  // Dependabot's bodies carry release notes with lines over 100 characters; its subjects follow
  // the prefix set in .github/dependabot.yml
  ignores: [(message) => message.includes("Signed-off-by: dependabot[bot]")],
  rules: {
    "scope-enum": [
      2,
      "always",
      ["core", "remote", "bench", "local", "page", "web", "dev", "deps", "readme"],
    ],
  },
};
