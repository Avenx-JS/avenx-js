This self-signed certificate and private key are public test fixtures only.
Never use them for a real development server or trust them on a device.

Generated with:

```sh
openssl req -x509 -newkey rsa:2048 -nodes -keyout server-key.pem -out server-cert.pem \
  -days 36500 -subj /CN=localhost -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1'
```
