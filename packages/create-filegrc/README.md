# create-filegrc

Create a FileGRC workspace for a SOC 2 program:

```sh
npx create-filegrc@latest company-grc
cd company-grc
npm run validate
npm run serve
```

The setup asks for the company name, your name as the initial policy owner, and a security contact email. The generated private project has one dependency, `filegrc`.

Use `npx create-filegrc@latest --help` for non-interactive options.
