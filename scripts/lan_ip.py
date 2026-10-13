"""Print this computer's local IPv4 address (the one a phone on the same Wi-Fi can reach)."""
import socket


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # no packet is sent; this only picks the outgoing interface
        ip = s.getsockname()[0]
    except OSError:
        ip = ""
    finally:
        s.close()
    if ip and not ip.startswith("127."):
        return ip
    try:
        candidates = socket.gethostbyname_ex(socket.gethostname())[2]
    except OSError:
        candidates = []
    return next((c for c in candidates if not c.startswith(("127.", "169.254."))), "")


if __name__ == "__main__":
    print(lan_ip())
