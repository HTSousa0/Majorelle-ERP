// Pequeno adaptador sobre o SQLite embutido do Node (node:sqlite). Assim o programa não depende de
// nenhuma biblioteca nativa e pode virar um executável único para Windows, Linux e macOS.
// Expõe só o que o projeto usa: exec, prepare, pragma, transaction e close.
import './silenciarAviso.js';
import { DatabaseSync } from 'node:sqlite';

export default class Database {
  constructor(arquivo) {
    this.db = new DatabaseSync(arquivo);
    this.profundidade = 0;
  }

  exec(sql) {
    this.db.exec(sql);
  }

  // prepare(...).run / get / all aceitam parâmetros posicionais (?) e nomeados ({ nome: 'x' } com @nome)
  prepare(sql) {
    return this.db.prepare(sql);
  }

  // db.pragma('user_version', { simple: true }) → valor; db.pragma('user_version = 2') → grava
  pragma(texto, { simple = false } = {}) {
    const linhas = this.db.prepare(`PRAGMA ${texto}`).all();
    if (!simple) return linhas;
    return linhas.length ? Object.values(linhas[0])[0] : undefined;
  }

  // Executa a função dentro de uma transação: se der erro, desfaz tudo (ROLLBACK).
  transaction(fn) {
    return (...args) => {
      if (this.profundidade > 0) return fn(...args); // já está dentro de uma transação
      this.db.exec('BEGIN');
      this.profundidade++;
      try {
        const resultado = fn(...args);
        this.db.exec('COMMIT');
        return resultado;
      } catch (erro) {
        this.db.exec('ROLLBACK');
        throw erro;
      } finally {
        this.profundidade--;
      }
    };
  }

  close() {
    this.db.close();
  }
}
