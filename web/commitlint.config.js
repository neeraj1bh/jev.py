export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      ["core", "remote", "bench", "local", "page", "web", "dev", "deps", "readme"],
    ],
  },
};
