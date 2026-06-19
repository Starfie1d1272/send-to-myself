import { customAlphabet } from "nanoid";

/** 对外 uid：16 位无歧义字符，不暴露顺序。 */
export const newId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 16);
