import { deflateSync } from "node:zlib";

export function createPdfWriter() {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  return {
    add,
    set(id, body) { objects[id - 1] = body; },
    stream(dictionary, data) {
      const compressed = deflateSync(data);
      return add(Buffer.concat([
        Buffer.from(`<< ${dictionary} /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`),
        compressed,
        Buffer.from("\nendstream")
      ]));
    },
    finish(root) {
      const chunks = [Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "latin1")];
      let offset = chunks[0].length;
      const offsets = ["0000000000 65535 f \n"];
      objects.forEach((body, index) => {
        const object = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), Buffer.from(body), Buffer.from("\nendobj\n")]);
        offsets.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
        chunks.push(object);
        offset += object.length;
      });
      chunks.push(Buffer.from(`xref\n0 ${offsets.length}\n${offsets.join("")}trailer\n<< /Size ${offsets.length} /Root ${root} 0 R >>\nstartxref\n${offset}\n%%EOF\n`));
      return Buffer.concat(chunks);
    }
  };
}
