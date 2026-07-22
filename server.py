import http.server
import socketserver
import cgi
import sys

class DumpHandler(http.server.SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header("Access-Control-Allow-Headers", "X-Requested-With, Content-type")
        self.end_headers()
        
    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length).decode('utf-8')
        
        with open('indiamart_dump.html', 'w', encoding='utf-8') as f:
            f.write(post_data)
            
        print("DOM dumped successfully!")
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(b"OK")
        
        # We can stop the server now that we have the data
        sys.exit(0)

PORT = 8080
with socketserver.TCPServer(("", PORT), DumpHandler) as httpd:
    print("serving at port", PORT)
    httpd.serve_forever()
