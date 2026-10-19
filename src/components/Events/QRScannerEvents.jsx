import { useState } from "react";
import PropTypes from "prop-types";
import { Scanner } from "@yudiel/react-qr-scanner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "../ui/button";
import { Icon } from "@iconify/react";

import { useUser } from "@/context/useUser";
import { parseEventQrPayload } from "@/lib/eventQr";
import QRScannedFamilyData from "./QRScannedFamilyData";

const QrScannerEvents = ({ eventData }) => {
  const [isValidQr, setIsValidQr] = useState(null); // if the qr code is valid
  const [isQrScanned, setIsQrScanned] = useState(false);
  const [selectedEvent, setselectedEvent] = useState("");
  const [eventDetails, setEventDetails] = useState([]);

  const { userData } = useUser(); // Get the userId
  const userId = userData?.id;

  const handleGetQrResult = (result) => {
    if (result && Array.isArray(result)) {
      const scannedEventId = parseEventQrPayload(result[0]?.rawValue); // scanned result
      setselectedEvent(scannedEventId ?? "");

      // Check if the scanned eventId exists in the eventData
      const matchedEvent =
        scannedEventId &&
        eventData?.find((event) => event.id === scannedEventId);

      if (matchedEvent) {
        setIsValidQr(true); // Valid QR code
        setIsQrScanned(true);
        setEventDetails(matchedEvent);
      } else {
        setIsValidQr(false); // Invalid QR code
      }
    }
  };

  const showScanner = () => {
    setIsValidQr(null);
    setIsQrScanned(false);
  };

  return (
    <Dialog onOpenChange={showScanner}>
      <DialogTrigger asChild>
        <Button>
          <Icon icon="mingcute:scan-line" className="mr-1" width={20} />
          QR Scanner
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="sr-only">
            Are you absolutely sure?
          </DialogTitle>
          <DialogDescription className="sr-only">
            This action cannot be undone. This will permanently delete your
            account and remove your data from our servers.
          </DialogDescription>
        </DialogHeader>
        {isValidQr === null && (
          <Scanner
            scanDelay={3000}
            allowMultiple={true}
            onScan={handleGetQrResult}
            components={{
              audio: false,
              torch: false,
            }}
          />
        )}
        {isValidQr === false && (
          <div className="flex flex-col items-center justify-center">
            <p>QR Code not found</p>
            <Button onClick={showScanner}>Scan Again</Button>
          </div>
        )}
        {isQrScanned && (
          <>
            <div className="text-primary-text">
              <h2 className="text-center text-2xl font-bold md:text-start">
                {eventDetails.name}
              </h2>
              <p className="text-center text-lg font-medium md:text-start">
                {new Date(
                  `${eventDetails.date}T${eventDetails.time}`
                ).toDateTime()}
              </p>
              <div className="flex items-center justify-center gap-x-1 text-primary-text sm:justify-start">
                <Icon icon="mingcute:information-line" width="20" height="20" />
                Choose who you would like to attend with.
              </div>
            </div>
            <QRScannedFamilyData
              userId={userId}
              selectedEvent={selectedEvent}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

QrScannerEvents.propTypes = {
  eventData: PropTypes.array,
};

export default QrScannerEvents;
