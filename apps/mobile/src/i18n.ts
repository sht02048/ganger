import ko from "../messages/ko.json";

type MessagePath<Node> = Node extends string
  ? never
  : {
      [Key in keyof Node & string]: Node[Key] extends string
        ? Key
        : `${Key}.${MessagePath<Node[Key]>}`;
    }[keyof Node & string];

export type MessageKey = MessagePath<typeof ko>;
export type MessageValues = Readonly<Record<string, string | number>>;

function lookUp(key: string): string {
  let node: unknown = ko;
  for (const part of key.split(".")) {
    node = typeof node === "object" && node !== null ? Reflect.get(node, part) : undefined;
  }
  if (typeof node !== "string") throw new Error(`missing message: ${key}`);
  return node;
}

export function t(key: MessageKey, values: MessageValues = {}): string {
  return lookUp(key).replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = values[name];
    return value === undefined ? placeholder : String(value);
  });
}
