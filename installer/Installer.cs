// Open Winlin Prompt — instalador (.exe)
//
// Instalador nativo: extrai o app (embutido como recurso), copia para a pasta
// do usuário, cria o atalho, libera o Ollama e abre o programa.
// Não executa scripts nem PowerShell — só instala arquivos, como um instalador
// comum, para evitar falsos positivos de antivírus.

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Installer
{
    private const string AppName = "Open Winlin Prompt";

    [STAThread]
    private static int Main(string[] args)
    {
        bool silent = args != null &&
            (Array.IndexOf(args, "--silent") >= 0 || Array.IndexOf(args, "/S") >= 0);

        if (silent)
        {
            // instalação silenciosa (sem janela) — útil para automação
            try
            {
                ExtractPackage(delegate { });
                AllowOllamaOrigin();
                CreateShortcut();
                return 0;
            }
            catch
            {
                return 1;
            }
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new SetupForm());
        return 0;
    }

    public static string TargetDir
    {
        get
        {
            // permite escolher a pasta (útil para testes e instalações portáteis)
            string custom = Environment.GetEnvironmentVariable("OWP_TARGET_DIR");
            if (!string.IsNullOrEmpty(custom)) return custom;
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs", "open-winlin-prompt");
        }
    }

    public static string OllamaExe
    {
        get
        {
            string local = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs", "Ollama", "ollama.exe");
            if (File.Exists(local)) return local;
            string programFiles = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Ollama", "ollama.exe");
            if (File.Exists(programFiles)) return programFiles;
            return null;
        }
    }

    public static string AppUrl
    {
        get { return "file:///" + Path.Combine(TargetDir, "dist", "index.html").Replace('\\', '/'); }
    }

    /// <summary>Extrai o pacote embutido para a pasta de instalação.</summary>
    public static void ExtractPackage(Action<int, string> report)
    {
        string dir = TargetDir;
        report(5, "Preparando a pasta...");
        if (Directory.Exists(dir))
        {
            report(10, "Removendo a versão anterior...");
            Directory.Delete(dir, true);
        }
        Directory.CreateDirectory(dir);

        using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
        {
            if (payload == null) throw new InvalidOperationException("Pacote do programa não encontrado no instalador.");

            using (var archive = new ZipArchive(payload, ZipArchiveMode.Read))
            {
                int total = archive.Entries.Count;
                int done = 0;
                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    string relative = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
                    string destination = Path.GetFullPath(Path.Combine(dir, relative));
                    if (!destination.StartsWith(Path.GetFullPath(dir), StringComparison.OrdinalIgnoreCase))
                        continue; // evita caminhos maliciosos no zip

                    if (entry.Name.Length == 0)
                    {
                        Directory.CreateDirectory(destination);
                    }
                    else
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(destination));
                        entry.ExtractToFile(destination, true);
                    }

                    done++;
                    report(10 + (int)(60.0 * done / Math.Max(1, total)), "Copiando arquivos...");
                }
            }
        }

        if (!File.Exists(Path.Combine(dir, "dist", "index.html")))
            throw new InvalidOperationException("O programa não foi extraído corretamente.");
    }

    /// <summary>Libera o acesso do app (file://) ao Ollama local.</summary>
    public static void AllowOllamaOrigin()
    {
        try
        {
            string current = Environment.GetEnvironmentVariable("OLLAMA_ORIGINS", EnvironmentVariableTarget.User);
            if (current != "*")
                Environment.SetEnvironmentVariable("OLLAMA_ORIGINS", "*", EnvironmentVariableTarget.User);
        }
        catch
        {
            // sem permissão: o app ainda oferece a configuração manual
        }
    }

    /// <summary>Cria o atalho na área de trabalho.</summary>
    public static string CreateShortcut()
    {
        string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        string linkPath = Path.Combine(desktop, AppName + ".lnk");
        object shell = null;
        try
        {
            Type type = Type.GetTypeFromProgID("WScript.Shell");
            if (type == null) return null;
            shell = Activator.CreateInstance(type);
            object link = type.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { linkPath });
            Type linkType = link.GetType();
            linkType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { Path.Combine(TargetDir, "Abrir Open Winlin Prompt.cmd") });
            linkType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { TargetDir });
            linkType.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { AppName });
            linkType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, link, new object[] { Path.Combine(TargetDir, "dist", "index.html") + ",0" });
            linkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
            return linkPath;
        }
        catch
        {
            return null;
        }
        finally
        {
            if (shell != null && Marshal.IsComObject(shell)) Marshal.ReleaseComObject(shell);
        }
    }

    /// <summary>Abre o app em janela sem barra de navegador (Edge/Chrome).</summary>
    public static void LaunchApp()
    {
        string[] browsers = new string[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\Chrome\Application\chrome.exe")
        };

        foreach (string browser in browsers)
        {
            if (!File.Exists(browser)) continue;
            try
            {
                Process.Start(browser, "--app=\"" + AppUrl + "\" --window-size=1440,900");
                return;
            }
            catch
            {
                // tenta o próximo
            }
        }

        try { Process.Start(AppUrl); } catch { }
    }
}

internal sealed class SetupForm : Form
{
    private readonly Label statusLabel;
    private readonly ProgressBar progressBar;
    private readonly CheckBox shortcutCheck;
    private readonly CheckBox openCheck;
    private readonly Button installButton;
    private readonly Button closeButton;
    private readonly Label ollamaLabel;

    public SetupForm()
    {
        Text = "Instalador — " + "Open Winlin Prompt";
        ClientSize = new Size(520, 372);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        BackColor = Color.FromArgb(24, 26, 32);
        ForeColor = Color.FromArgb(233, 233, 244);
        Font = new Font("Segoe UI", 9.5f);

        var title = new Label();
        title.Text = "Open Winlin Prompt";
        title.Font = new Font("Segoe UI", 17f, FontStyle.Bold);
        title.ForeColor = Color.FromArgb(0, 210, 255);
        title.AutoSize = true;
        title.Location = new Point(24, 20);
        Controls.Add(title);

        var subtitle = new Label();
        subtitle.Text = "Editor de prompts com IA local — instalação no seu usuário, sem administrador";
        subtitle.ForeColor = Color.FromArgb(150, 156, 170);
        subtitle.AutoSize = true;
        subtitle.Location = new Point(26, 56);
        Controls.Add(subtitle);

        var target = new Label();
        target.Text = "Destino: " + Installer.TargetDir;
        target.ForeColor = Color.FromArgb(120, 126, 140);
        target.AutoSize = false;
        target.Size = new Size(470, 20);
        target.Location = new Point(26, 80);
        Controls.Add(target);

        shortcutCheck = new CheckBox();
        shortcutCheck.Text = "Criar atalho na área de trabalho";
        shortcutCheck.Checked = true;
        shortcutCheck.ForeColor = Color.FromArgb(210, 214, 224);
        shortcutCheck.AutoSize = true;
        shortcutCheck.Location = new Point(26, 112);
        Controls.Add(shortcutCheck);

        openCheck = new CheckBox();
        openCheck.Text = "Abrir o Open Winlin Prompt ao concluir";
        openCheck.Checked = true;
        openCheck.ForeColor = Color.FromArgb(210, 214, 224);
        openCheck.AutoSize = true;
        openCheck.Location = new Point(26, 138);
        Controls.Add(openCheck);

        ollamaLabel = new Label();
        ollamaLabel.AutoSize = false;
        ollamaLabel.Size = new Size(470, 34);
        ollamaLabel.Location = new Point(26, 166);
        ollamaLabel.ForeColor = Color.FromArgb(150, 200, 170);
        ollamaLabel.Text = Installer.OllamaExe != null
            ? "Ollama encontrado — ative as sugestões de IA nas configurações do app."
            : "Ollama não encontrado: instale em ollama.com/download e ative a IA no app.";
        Controls.Add(ollamaLabel);

        if (Installer.OllamaExe == null)
        {
            var ollamaLink = new LinkLabel();
            ollamaLink.Text = "Baixar o Ollama";
            ollamaLink.AutoSize = true;
            ollamaLink.LinkColor = Color.FromArgb(0, 210, 255);
            ollamaLink.ActiveLinkColor = Color.FromArgb(58, 123, 213);
            ollamaLink.Location = new Point(26, 194);
            ollamaLink.LinkClicked += delegate
            {
                try { Process.Start("https://ollama.com/download"); } catch { }
            };
            Controls.Add(ollamaLink);
        }

        progressBar = new ProgressBar();
        progressBar.Location = new Point(26, 214);
        progressBar.Size = new Size(468, 14);
        progressBar.Minimum = 0;
        progressBar.Maximum = 100;
        Controls.Add(progressBar);

        statusLabel = new Label();
        statusLabel.Text = "Pronto para instalar.";
        statusLabel.ForeColor = Color.FromArgb(160, 220, 190);
        statusLabel.AutoSize = false;
        statusLabel.Size = new Size(468, 24);
        statusLabel.Location = new Point(26, 234);
        Controls.Add(statusLabel);

        var note = new Label();
        note.Text = "Projeto open source (MIT) · github.com/PedroNunes0z/open-winlin-prompt";
        note.ForeColor = Color.FromArgb(110, 116, 130);
        note.AutoSize = true;
        note.Location = new Point(26, 262);
        Controls.Add(note);

        installButton = new Button();
        installButton.Text = "Instalar";
        installButton.Size = new Size(130, 36);
        installButton.Location = new Point(26, 300);
        installButton.BackColor = Color.FromArgb(0, 168, 214);
        installButton.ForeColor = Color.White;
        installButton.FlatStyle = FlatStyle.Flat;
        installButton.FlatAppearance.BorderSize = 0;
        installButton.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
        installButton.Click += OnInstall;
        Controls.Add(installButton);

        closeButton = new Button();
        closeButton.Text = "Fechar";
        closeButton.Size = new Size(110, 36);
        closeButton.Location = new Point(384, 300);
        closeButton.FlatStyle = FlatStyle.Flat;
        closeButton.FlatAppearance.BorderColor = Color.FromArgb(70, 76, 92);
        closeButton.ForeColor = Color.FromArgb(210, 214, 224);
        closeButton.Click += delegate { Close(); };
        Controls.Add(closeButton);
    }

    private void Report(int percent, string text)
    {
        if (InvokeRequired)
        {
            BeginInvoke((Action)delegate { Report(percent, text); });
            return;
        }
        progressBar.Value = Math.Min(100, Math.Max(0, percent));
        statusLabel.Text = text;
    }

    private void OnInstall(object sender, EventArgs e)
    {
        installButton.Enabled = false;
        closeButton.Enabled = false;
        shortcutCheck.Enabled = false;
        openCheck.Enabled = false;
        statusLabel.ForeColor = Color.FromArgb(200, 200, 210);

        bool makeShortcut = shortcutCheck.Checked;
        bool openAfter = openCheck.Checked;

        var worker = new Thread(delegate()
        {
            try
            {
                Installer.ExtractPackage(Report);
                Report(72, "Liberando o acesso ao Ollama...");
                Installer.AllowOllamaOrigin();
                Report(82, "Criando atalho...");
                string link = null;
                if (makeShortcut) link = Installer.CreateShortcut();
                Report(100, "Instalação concluída!");
                Finish(true,
                    "Instalação concluída!" + Environment.NewLine +
                    "Programa em: " + Installer.TargetDir +
                    (link != null ? Environment.NewLine + "Atalho: " + link : string.Empty),
                    openAfter);
            }
            catch (Exception error)
            {
                Finish(false, "Falha na instalação: " + error.Message, false);
            }
        });
        worker.IsBackground = true;
        worker.Start();
    }

    private void Finish(bool ok, string message, bool openAfter)
    {
        if (InvokeRequired)
        {
            BeginInvoke((Action)delegate { Finish(ok, message, openAfter); });
            return;
        }

        statusLabel.ForeColor = ok ? Color.FromArgb(160, 220, 190) : Color.FromArgb(240, 163, 144);
        statusLabel.Text = message.Split('\n')[0];
        progressBar.Value = ok ? 100 : progressBar.Value;
        installButton.Enabled = !ok;
        installButton.Text = ok ? "Instalado" : "Tentar de novo";
        closeButton.Enabled = true;
        closeButton.Text = "Concluir";

        if (ok && openAfter)
        {
            try { Installer.LaunchApp(); } catch { }
        }
        if (!ok)
        {
            MessageBox.Show(message, "Open Winlin Prompt", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
