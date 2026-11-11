// Backup (somente administradores): status, backup agora e download.
import { Router } from 'express';
import { lerConfig } from '../db/index.js';
import { ErroHttp } from '../utils/erros.js';

export function backupRouter(db, servico) {
  const r = Router();

  r.get('/', (req, res) => {
    res.json({
      ativo: lerConfig(db, 'backup_ativo', 'true') === 'true',
      intervalo_horas: Number(lerConfig(db, 'backup_intervalo_horas', '6')),
      manter: Number(lerConfig(db, 'backup_manter', '20')),
      pasta: servico.pastaBackups,
      pasta_extra: lerConfig(db, 'backup_pasta_extra', ''),
      ultimo: lerConfig(db, 'backup_ultimo', '') || null,
      ultimo_erro: lerConfig(db, 'backup_ultimo_erro', '') || null,
      arquivos: servico.listar(),
    });
  });

  r.post('/agora', (req, res) => {
    const resultado = servico.criarBackup();
    if (!resultado.ok) throw new ErroHttp(500, `O backup falhou: ${resultado.erro}`);
    res.status(201).json(resultado);
  });

  r.get('/:nome/baixar', (req, res) => {
    res.download(servico.caminhoDoBackup(req.params.nome));
  });

  return r;
}
