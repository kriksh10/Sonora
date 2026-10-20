/** Synthetic, minimal classic Word/OLE fixture. Contains no real applicant data. */
export function legacyDoc(text: string) {
  const END = 0xfffffffe, FREE = 0xffffffff;
  const header = Buffer.alloc(512);
  Buffer.from("d0cf11e0a1b11ae1", "hex").copy(header);
  header.writeUInt16LE(0x3e, 24); header.writeUInt16LE(3, 26); header.writeUInt16LE(0xfffe, 28);
  header.writeUInt16LE(9, 30); header.writeUInt16LE(6, 32);
  header.writeUInt32LE(1, 44); header.writeUInt32LE(1, 48); header.writeUInt32LE(4096, 56);
  header.writeUInt32LE(END, 60); header.writeUInt32LE(END, 68);
  for (let i = 76; i < 512; i += 4) header.writeUInt32LE(FREE, i);
  header.writeUInt32LE(0, 76);
  const fat = Buffer.alloc(512, 0xff);
  fat.writeUInt32LE(0xfffffffd, 0); fat.writeUInt32LE(END, 4);
  for (let i = 2; i <= 17; i++) fat.writeUInt32LE(i === 9 || i === 17 ? END : i + 1, i * 4);
  const directory = Buffer.alloc(512);
  function entry(index: number, name: string, type: number, start: number, size: number, child = FREE, right = FREE) {
    const offset = index * 128;
    const bytes = Buffer.from(`${name}\0`, "utf16le");
    bytes.copy(directory, offset);
    directory.writeUInt16LE(bytes.length, offset + 64);
    directory[offset + 66] = type; directory[offset + 67] = 1;
    directory.writeUInt32LE(FREE, offset + 68); directory.writeUInt32LE(right, offset + 72);
    directory.writeUInt32LE(child, offset + 76); directory.writeUInt32LE(start, offset + 116);
    directory.writeUInt32LE(size, offset + 120);
  }
  entry(0, "Root Entry", 5, END, 0, 1);
  entry(1, "WordDocument", 2, 2, 4096, FREE, 2); entry(2, "0Table", 2, 10, 4096);
  const word = Buffer.alloc(4096), table = Buffer.alloc(4096);
  word.writeUInt16LE(0xa5ec, 0); word.writeUInt16LE(0xc1, 2);
  word.writeUInt32LE(512, 0x18); word.writeUInt32LE(text.length, 0x4c);
  word.writeUInt32LE(21, 0x1a6); Buffer.from(text, "utf16le").copy(word, 512);
  table[0] = 2; table.writeUInt32LE(16, 1); table.writeUInt32LE(text.length, 9);
  table.writeUInt32LE(512, 15);
  return Buffer.concat([header, fat, directory, word, table]);
}
