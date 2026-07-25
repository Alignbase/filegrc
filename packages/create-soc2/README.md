# create-soc2

Create a plain-file SOC 2 GRC workspace:

```sh
npx create-soc2@latest company-soc2
cd company-soc2
npm run validate
npm run serve
```

The setup asks for the company name, your name as the initial policy owner, and a security contact email. The generated private project has one dependency, `soc2`.

Use `npx create-soc2@latest --help` for non-interactive options.
