import express from 'express'
import routesAlunos from './src/routes/alunos'
import routesProdutos from './src/routes/emprestimos'
import routesDepositos from './src/routes/livros'
import routesVendas from './src/routes/vendas'

const app = express()
const port = 3000

app.use(express.json())

app.use("/alunos", routesAlunos)
app.use("/livros", routesLivros)
app.use("/emprestimos", routesEmprestimos)


app.get('/', (req, res) => {
  res.send('API: Controle de Vendas da Cantina')
})

app.listen(port, () => {
  console.log(`Servidor rodando na porta: ${port}`)
})