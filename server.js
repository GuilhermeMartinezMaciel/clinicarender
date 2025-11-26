// ARQUIVO: server.js (VERSÃO FINAL COM LOGIN E ANAMNESE)
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
// O Render vai decidir a porta, ou usa 3000 se for no seu PC
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const db = new sqlite3.Database('./clinica.db', (err) => {
    if (err) console.error(err.message);
    else {
        console.log('Conectado ao Banco.');
        criarTabelas();
    }
});

function criarTabelas() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS profissionais (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT)`);
        db.run(`CREATE TABLE IF NOT EXISTS estoque (id INTEGER PRIMARY KEY AUTOINCREMENT, produto TEXT, quantidade INTEGER, unidade TEXT)`);
        
        // Tabela de Agendamentos (com Status)
        db.run(`CREATE TABLE IF NOT EXISTS agendamentos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cliente TEXT,
            profissional_id INTEGER,
            procedimento TEXT,
            data_hora TEXT,
            valor REAL,
            forma_pagamento TEXT,
            produto_usado_id INTEGER, 
            qtd_usada INTEGER,
            status TEXT DEFAULT 'Agendado'
        )`);

        // NOVA TABELA: Ficha de Anamnese
        db.run(`CREATE TABLE IF NOT EXISTS anamnese (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cliente_nome TEXT,
            texto TEXT,
            data_registro DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
    });
}

// --- ROTAS DE SEGURANÇA ---
app.post('/api/login', (req, res) => {
    const { usuario, senha } = req.body;
    // LOGIN FIXO PARA TESTE (Pode mudar aqui)
    if (usuario === 'admin' && senha === '1234') {
        res.json({ message: 'Sucesso' });
    } else {
        res.status(401).json({ error: 'Falha no login' });
    }
});

// --- ROTAS AGENDAMENTO E STATUS ---

app.post('/api/agendar', (req, res) => {
    const { cliente, profissional_id, procedimento, data_hora, valor, forma_pagamento, produto_id, qtd_usada } = req.body;
    
    // Se usar produto, baixa o estoque
    if (produto_id && qtd_usada > 0) {
        db.run(`UPDATE estoque SET quantidade = quantidade - ? WHERE id = ?`, [qtd_usada, produto_id]);
    }

    const sql = `INSERT INTO agendamentos (cliente, profissional_id, procedimento, data_hora, valor, forma_pagamento, produto_usado_id, qtd_usada, status) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Agendado')`;
    
    db.run(sql, [cliente, profissional_id, procedimento, data_hora, valor, forma_pagamento, produto_id, qtd_usada], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Agendado!' });
    });
});

// Atualizar Status (Confirmar ou Cancelar)
app.post('/api/agendamentos/:id/status', (req, res) => {
    const { status } = req.body; // 'Concluido' ou 'Cancelado'
    const { id } = req.params;
    
    db.run(`UPDATE agendamentos SET status = ? WHERE id = ?`, [status, id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Status atualizado' });
    });
});

// Listar (Só mostra os 'Agendados' na tela principal para não poluir)
app.get('/api/agendamentos', (req, res) => {
    const sql = `SELECT a.*, p.nome as nome_profissional 
                 FROM agendamentos a 
                 LEFT JOIN profissionais p ON a.profissional_id = p.id 
                 WHERE a.status = 'Agendado'
                 ORDER BY a.data_hora ASC`;
    db.all(sql, [], (err, rows) => res.json(rows));
});

// --- ROTAS ANAMNESE ---
app.get('/api/anamnese/:cliente', (req, res) => {
    db.all("SELECT * FROM anamnese WHERE cliente_nome = ? ORDER BY id DESC", [req.params.cliente], (err, rows) => res.json(rows));
});

app.post('/api/anamnese', (req, res) => {
    const { cliente_nome, texto } = req.body;
    db.run("INSERT INTO anamnese (cliente_nome, texto) VALUES (?, ?)", [cliente_nome, texto], (err) => {
        if(err) return res.status(500).json({error: err.message});
        res.json({message: "Nota salva"});
    });
});

// --- ROTAS GERAIS (Profissionais, Estoque, Financeiro) ---
app.get('/api/resumo_financeiro', (req, res) => {
    // Conta tudo, inclusive os concluídos
    db.all("SELECT forma_pagamento, SUM(valor) as total FROM agendamentos WHERE status != 'Cancelado' GROUP BY forma_pagamento", [], (err, rows) => res.json(rows));
});

app.get('/api/profissionais', (req, res) => db.all("SELECT * FROM profissionais", [], (err, r) => res.json(r)));
app.post('/api/profissionais', (req, res) => db.run("INSERT INTO profissionais (nome) VALUES (?)", [req.body.nome], () => res.json({msg: "Ok"})));

app.get('/api/estoque', (req, res) => db.all("SELECT * FROM estoque", [], (err, r) => res.json(r)));
app.post('/api/estoque', (req, res) => {
    db.get("SELECT * FROM estoque WHERE produto = ?", [req.body.produto], (err, row) => {
        if (row) db.run("UPDATE estoque SET quantidade = quantidade + ? WHERE id = ?", [req.body.quantidade, row.id], () => res.json({msg: "Atualizado"}));
        else db.run("INSERT INTO estoque (produto, quantidade, unidade) VALUES (?, ?, ?)", [req.body.produto, req.body.quantidade, req.body.unidade], () => res.json({msg: "Criado"}));
    });
});

// --- NOVAS ROTAS DE EXCLUSÃO (Para corrigir erros) ---

// 1. Excluir Estoque
app.delete('/api/estoque/:id', (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM estoque WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Item excluído" });
    });
});

// 2. Excluir Profissional
app.delete('/api/profissionais/:id', (req, res) => {
    const { id } = req.params;
    // Nota: Se o profissional tiver agendamentos antigos, eles ficarão sem nome (ou como 'Profissional Excluído')
    db.run("DELETE FROM profissionais WHERE id = ?", [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Profissional excluído" });
    });
});

app.listen(port, () => console.log(`Sistema Online em http://localhost:${port}`));