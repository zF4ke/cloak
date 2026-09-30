if (process.argv.includes("--cloak-setup"))
  void import("../setup/main.ts").then(({ openSetup }) => openSetup());
else void import("./main.ts");
