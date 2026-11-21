// Open Winlin Prompt — bootstrapper do instalador (.exe)
//
// O pacote pronto (open-winlin-prompt.zip) é embutido como recurso deste
// executável. Ao rodar, ele:
//   1. extrai o pacote para uma pasta temporária,
//   2. abre o instalador gráfico (Instalar.ps1 -PacoteLocal <zip>),
//   3. remove a pasta temporária ao final.
// Nada é instalado sem o usuário confirmar na janela do instalador.

using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;

internal static class Bootstrap
{
    [STAThread]
    private static int Main(string[] args)
    {
        string workDir = Path.Combine(Path.GetTempPath(), "owp-setup-" + Guid.NewGuid().ToString("N").Substring(0, 8));
        try
        {
            Directory.CreateDirectory(workDir);

            // 1. extrai o pacote embutido
            string zipPath = Path.Combine(workDir, "open-winlin-prompt.zip");
            using (Stream resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
            {
                if (resource == null)
                {
                    Fail("O pacote embutido não foi encontrado no instalador.");
                    return 1;
                }
                using (FileStream file = File.Create(zipPath))
                {
                    resource.CopyTo(file);
                }
            }

            ZipFile.ExtractToDirectory(zipPath, workDir);

            string script = Path.Combine(workDir, "Instalar.ps1");
            if (!File.Exists(script))
            {
                Fail("O instalador (Instalar.ps1) não está no pacote.");
                return 1;
            }

            // 2. roda o instalador gráfico com o pacote local
            var psi = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell\\v1.0\\powershell.exe"),
                Arguments = "-NoProfile -STA -ExecutionPolicy Bypass -File \"" + script + "\" -PacoteLocal \"" + zipPath + "\"",
                UseShellExecute = false,
            };

            using (Process process = Process.Start(psi))
            {
                process.WaitForExit();
            }

            return 0;
        }
        catch (Exception error)
        {
            Fail(error.Message);
            return 1;
        }
        finally
        {
            // 3. limpeza (o app instalado não depende desta pasta)
            try
            {
                if (Directory.Exists(workDir)) Directory.Delete(workDir, true);
            }
            catch
            {
                // arquivos em uso: o Windows limpa depois
            }
        }
    }

    private static void Fail(string message)
    {
        MessageBox.Show(message, "Open Winlin Prompt — Instalador", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
