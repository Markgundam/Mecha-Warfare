// Mecha Warfare desktop launcher: serves the game (embedded as resources) on this computer and opens it in the browser.
// Built with the .NET Framework compiler that ships with Windows (C# 5), so the exe stays small and needs no install.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;

[assembly: AssemblyTitle("Mecha Warfare")]
[assembly: AssemblyProduct("Mecha Warfare")]
[assembly: AssemblyVersion("1.0.0.0")]

class App
{
    static readonly Dictionary<string, string[]> Files = new Dictionary<string, string[]>
    {
        { "/", new[] { "index.html", "text/html; charset=utf-8" } },
        { "/index.html", new[] { "index.html", "text/html; charset=utf-8" } },
        { "/engine.js", new[] { "engine.js", "text/javascript; charset=utf-8" } },
        { "/render3d.js", new[] { "render3d.js", "text/javascript; charset=utf-8" } },
        { "/three.min.js", new[] { "three.min.js", "text/javascript; charset=utf-8" } },
        { "/peerjs.min.js", new[] { "peerjs.min.js", "text/javascript; charset=utf-8" } },
        { "/standalone.js", new[] { "standalone.js", "text/javascript; charset=utf-8" } }
    };
    static readonly Dictionary<string, byte[]> Cache = new Dictionary<string, byte[]>();

    static byte[] Res(string name)
    {
        lock (Cache)
        {
            byte[] b;
            if (Cache.TryGetValue(name, out b)) return b;
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
            using (MemoryStream ms = new MemoryStream())
            {
                s.CopyTo(ms);
                b = ms.ToArray();
            }
            Cache[name] = b;
            return b;
        }
    }

    static void Main()
    {
        try { Console.Title = "Mecha Warfare"; } catch (Exception) { /* no console window */ }
        // a fixed port keeps saved games: the browser stores them per address
        int[] ports = { 47615, 47616, 47617, 47618, 47619 };
        TcpListener listener = null;
        int port = 0;
        foreach (int p in ports)
        {
            try { listener = new TcpListener(IPAddress.Loopback, p); listener.Start(); port = p; break; }
            catch (SocketException) { listener = null; }
        }
        if (listener == null)
        {
            Console.WriteLine("Could not find a free port. Close other copies of Mecha Warfare and try again.");
            Thread.Sleep(8000);
            return;
        }
        string url = "http://127.0.0.1:" + port + "/";
        Console.WriteLine();
        Console.WriteLine("  MECHA WARFARE");
        Console.WriteLine("  The game is open in your web browser: " + url);
        Console.WriteLine("  Keep this window open while you play. Close it to quit.");
        Console.WriteLine();
        Console.WriteLine("  Online: one player hosts a match and shares its 5-letter code;");
        Console.WriteLine("  the other joins with that code from their own copy of the game.");
        Console.WriteLine("  The host must keep the game open for the match to continue.");
        if (Environment.GetEnvironmentVariable("MW_NO_BROWSER") == null)
        {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
            catch (Exception) { Console.WriteLine("  Open " + url + " in your browser."); }
        }
        while (true)
        {
            TcpClient client = listener.AcceptTcpClient();
            ThreadPool.QueueUserWorkItem(Handle, client);
        }
    }

    static void Handle(object state)
    {
        TcpClient client = (TcpClient)state;
        try
        {
            using (client)
            {
                NetworkStream ns = client.GetStream();
                ns.ReadTimeout = 10000;
                byte[] buf = new byte[8192];
                StringBuilder sb = new StringBuilder();
                int n;
                while ((n = ns.Read(buf, 0, buf.Length)) > 0)
                {
                    sb.Append(Encoding.ASCII.GetString(buf, 0, n));
                    if (sb.ToString().Contains("\r\n\r\n") || sb.Length > 65536) break;
                }
                string[] parts = sb.ToString().Split('\n')[0].Split(' ');
                string path = parts.Length > 1 ? parts[1].Split('?')[0] : "/";
                string[] f;
                byte[] body;
                string status = "200 OK", type;
                if (Files.TryGetValue(path, out f)) { body = Res(f[0]); type = f[1]; }
                else { body = Encoding.UTF8.GetBytes("Not found"); type = "text/plain"; status = "404 Not Found"; }
                byte[] head = Encoding.ASCII.GetBytes("HTTP/1.1 " + status + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.Length + "\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n");
                ns.Write(head, 0, head.Length);
                ns.Write(body, 0, body.Length);
            }
        }
        catch (Exception) { /* the browser hung up */ }
    }
}
