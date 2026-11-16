//! Finding the cable: the serial ports of this computer with what the user needs to recognise
//! the USB-DMX cable (port, USB VID/PID, manufacturer, product, serial number), the engine's
//! guess, and the ways to open them.
//!
//! On Windows the "product" is the name Windows gives the port (for FTDI chips usually
//! "USB Serial Port"), so names alone rarely tell a Pro from an Open DMX: VID/PID say which
//! chip it is, and on connect the engine asks the device whether it is a Pro.

use serde::Serialize;

use super::driver::{DmxPort, SerialDmxPort};

/// The engine's guess about a port.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Guess {
    /// The name says it is a Pro-type interface (Enttec Pro, DMXking…).
    Pro,
    /// An FTDI chip: an Open DMX cable, or a Pro clone (on connect Granvelo asks it).
    Ftdi,
    /// Another USB serial adapter: not a known DMX cable (can be tried by hand as Open DMX).
    OtherUsb,
    /// Not USB (a built-in or Bluetooth port): not a DMX cable.
    NotUsb,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    /// "COM3", "/dev/ttyUSB0"…
    pub port: String,
    pub usb: bool,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial: Option<String>,
    /// The chip known from VID/PID ("FTDI FT232R / FT245R"…).
    pub chip: Option<String>,
    pub guess: Guess,
    /// A short name to show ("DMX USB PRO", "FTDI FT232R / FT245R"…).
    pub name: String,
}

/// Why opening or finding a cable failed (the interface explains each code in plain words).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkError {
    pub code: ErrorCode,
    pub message: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    /// No USB-DMX cable among the ports.
    NoCable,
    /// The chosen port is not there (unplugged, or another name).
    NotFound,
    /// The port is used by another program.
    Busy,
    /// Any other problem opening the port.
    OpenFailed,
}

impl LinkError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        LinkError {
            code,
            message: message.into(),
        }
    }
}

/// The chip of a USB serial adapter, from its VID/PID.
pub fn chip_name(vid: u16, pid: u16) -> Option<&'static str> {
    Some(match (vid, pid) {
        (0x0403, 0x6001) => "FTDI FT232R / FT245R",
        (0x0403, 0x6010) => "FTDI FT2232",
        (0x0403, 0x6011) => "FTDI FT4232",
        (0x0403, 0x6014) => "FTDI FT232H",
        (0x0403, 0x6015) => "FTDI FT-X",
        (0x0403, _) => "FTDI",
        (0x1A86, _) => "WCH CH340 / CH341",
        (0x10C4, _) => "Silicon Labs CP210x",
        (0x067B, _) => "Prolific PL2303",
        (0x0483, 0x5740) => "STM32 (virtual COM port)",
        (0x2341, _) | (0x2A03, _) => "Arduino",
        _ => return None,
    })
}

/// The guess from what the port says about itself.
pub fn guess(
    usb: bool,
    vid: Option<u16>,
    manufacturer: Option<&str>,
    product: Option<&str>,
) -> Guess {
    if !usb {
        return Guess::NotUsb;
    }
    let text = format!("{} {}", manufacturer.unwrap_or(""), product.unwrap_or("")).to_lowercase();
    let says_open = text.contains("open dmx") || text.contains("opendmx");
    let says_pro = text.contains("dmxking")
        || text.contains("ultradmx")
        || (text.contains("dmx") && text.contains("pro"))
        || (text.contains("enttec") && !says_open);
    if says_pro && !says_open {
        Guess::Pro
    } else if vid == Some(0x0403) {
        Guess::Ftdi
    } else {
        Guess::OtherUsb
    }
}

/// What USB says about an adapter: VID, PID, serial number, manufacturer, product.
pub type UsbIds = (u16, u16, Option<String>, Option<String>, Option<String>);

/// Builds the description of a port.
pub fn describe(port: &str, usb: Option<UsbIds>) -> DeviceInfo {
    match usb {
        Some((vid, pid, serial, manufacturer, product)) => {
            let chip = chip_name(vid, pid).map(str::to_string);
            let g = guess(true, Some(vid), manufacturer.as_deref(), product.as_deref());
            let generic = |p: &str| {
                let p = p.to_lowercase();
                p.is_empty()
                    || p.contains("usb serial")
                    || p.contains("usb uart")
                    || p.contains("serial port")
            };
            let name = match (&product, &chip) {
                (Some(p), _) if !generic(p) => p.clone(),
                (_, Some(c)) => c.clone(),
                (Some(p), None) => p.clone(),
                (None, None) => format!("USB {vid:04X}:{pid:04X}"),
            };
            DeviceInfo {
                port: port.to_string(),
                usb: true,
                vid: Some(vid),
                pid: Some(pid),
                manufacturer,
                product,
                serial,
                chip,
                guess: g,
                name,
            }
        }
        None => DeviceInfo {
            port: port.to_string(),
            usb: false,
            vid: None,
            pid: None,
            manufacturer: None,
            product: None,
            serial: None,
            chip: None,
            guess: Guess::NotUsb,
            name: port.to_string(),
        },
    }
}

/// The same physical device in a new list (after it was unplugged and plugged back): same
/// VID/PID and serial number; without a serial number, the same port, or the only device
/// with that VID/PID. Not USB: the same port name.
pub fn find_again<'a>(list: &'a [DeviceInfo], dev: &DeviceInfo) -> Option<&'a DeviceInfo> {
    if !dev.usb {
        return list.iter().find(|d| d.port == dev.port);
    }
    let same_ids = |d: &&DeviceInfo| d.usb && d.vid == dev.vid && d.pid == dev.pid;
    if dev.serial.is_some() {
        return list
            .iter()
            .filter(same_ids)
            .find(|d| d.serial == dev.serial);
    }
    if let Some(d) = list.iter().filter(same_ids).find(|d| d.port == dev.port) {
        return Some(d);
    }
    let mut same: Vec<&DeviceInfo> = list.iter().filter(same_ids).collect();
    if same.len() == 1 { same.pop() } else { None }
}

/// Where ports come from and how they are opened (the real computer, or fakes in the tests).
pub trait Backend: Send + Sync {
    fn list(&self) -> Vec<DeviceInfo>;
    fn open(&self, port: &str) -> Result<Box<dyn DmxPort>, LinkError>;
}

/// The serial ports of this computer.
pub struct SystemBackend;

impl Backend for SystemBackend {
    fn list(&self) -> Vec<DeviceInfo> {
        let ports = match serialport::available_ports() {
            Ok(p) => p,
            Err(e) => {
                log_line(&format!("listing serial ports failed: {e}"));
                return Vec::new();
            }
        };
        let mut out: Vec<DeviceInfo> = ports
            .into_iter()
            .map(|p| match p.port_type {
                serialport::SerialPortType::UsbPort(u) => describe(
                    &p.port_name,
                    Some((u.vid, u.pid, u.serial_number, u.manufacturer, u.product)),
                ),
                _ => describe(&p.port_name, None),
            })
            .collect();
        // USB first (the cables), then by name.
        out.sort_by(|a, b| b.usb.cmp(&a.usb).then_with(|| a.port.cmp(&b.port)));
        out
    }

    fn open(&self, port: &str) -> Result<Box<dyn DmxPort>, LinkError> {
        match SerialDmxPort::open(port) {
            Ok(p) => Ok(Box::new(p)),
            Err(e) => Err(open_error(port, &e)),
        }
    }
}

fn open_error(port: &str, e: &serialport::Error) -> LinkError {
    let message = format!("{port}: {e}");
    // Windows reports "in use" and "not there" alike (and in the system language): the port
    // being still listed is what tells them apart.
    let listed = serialport::available_ports()
        .map(|l| l.iter().any(|p| p.port_name == port))
        .unwrap_or(true);
    let code = match e.kind {
        _ if !listed => ErrorCode::NotFound,
        serialport::ErrorKind::NoDevice
        | serialport::ErrorKind::Io(std::io::ErrorKind::PermissionDenied) => ErrorCode::Busy,
        serialport::ErrorKind::Io(std::io::ErrorKind::NotFound) => ErrorCode::NotFound,
        _ => ErrorCode::OpenFailed,
    };
    LinkError::new(code, message)
}

/// Diagnostics on stderr (visible when Granvelo is started from a terminal).
pub fn log_line(s: &str) {
    eprintln!("[granvelo dmx] {s}");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usb(
        port: &str,
        vid: u16,
        pid: u16,
        serial: Option<&str>,
        m: Option<&str>,
        p: Option<&str>,
    ) -> DeviceInfo {
        describe(
            port,
            Some((
                vid,
                pid,
                serial.map(Into::into),
                m.map(Into::into),
                p.map(Into::into),
            )),
        )
    }

    #[test]
    fn guesses_from_names_and_chips() {
        assert_eq!(
            usb(
                "COM3",
                0x0403,
                0x6001,
                Some("EN123"),
                Some("ENTTEC"),
                Some("DMX USB PRO")
            )
            .guess,
            Guess::Pro
        );
        assert_eq!(
            usb(
                "COM3",
                0x0403,
                0x6001,
                None,
                Some("FTDI"),
                Some("USB Serial Port")
            )
            .guess,
            Guess::Ftdi
        );
        assert_eq!(
            usb(
                "COM4",
                0x0403,
                0x6001,
                None,
                Some("ENTTEC"),
                Some("Open DMX USB")
            )
            .guess,
            Guess::Ftdi
        );
        assert_eq!(
            usb(
                "COM5",
                0x1A86,
                0x7523,
                None,
                Some("wch.cn"),
                Some("USB-SERIAL CH340")
            )
            .guess,
            Guess::OtherUsb
        );
        assert_eq!(describe("COM1", None).guess, Guess::NotUsb);
        let d = usb(
            "COM3",
            0x0403,
            0x6001,
            None,
            Some("FTDI"),
            Some("USB Serial Port"),
        );
        assert_eq!(d.name, "FTDI FT232R / FT245R");
        assert_eq!(d.chip.as_deref(), Some("FTDI FT232R / FT245R"));
        assert_eq!(
            usb(
                "COM3",
                0x0403,
                0x6001,
                None,
                Some("ENTTEC"),
                Some("DMX USB PRO")
            )
            .name,
            "DMX USB PRO"
        );
    }

    #[test]
    fn finds_the_same_cable_again_by_identity_not_by_port_name() {
        let before = usb("COM3", 0x0403, 0x6001, Some("A1"), None, None);
        let list = vec![
            usb("COM3", 0x0403, 0x6001, Some("B2"), None, None),
            usb("COM7", 0x0403, 0x6001, Some("A1"), None, None),
        ];
        assert_eq!(find_again(&list, &before).unwrap().port, "COM7");
        let no_serial = usb("COM3", 0x0403, 0x6001, None, None, None);
        assert_eq!(
            find_again(&[usb("COM9", 0x0403, 0x6001, None, None, None)], &no_serial)
                .unwrap()
                .port,
            "COM9"
        );
        assert!(
            find_again(
                &[
                    usb("COM9", 0x0403, 0x6001, None, None, None),
                    usb("COM8", 0x0403, 0x6001, None, None, None)
                ],
                &no_serial
            )
            .is_none()
        );
        assert!(find_again(&[usb("COM3", 0x1A86, 0x7523, None, None, None)], &no_serial).is_none());
    }
}
