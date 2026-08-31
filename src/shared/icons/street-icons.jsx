export const ShapeDraw24Icon = () => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M4 18L9 5L19 8L20 18"
      stroke="white"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
    <path
      d="M20 18L4 18"
      stroke="white"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeDasharray="3 4"
      fill="none"
    />
    <circle cx="4" cy="18" r="1.8" fill="white" />
    <circle cx="9" cy="5" r="1.8" fill="white" />
    <circle cx="19" cy="8" r="1.8" fill="white" />
    <circle cx="20" cy="18" r="1.8" fill="white" />
  </svg>
);

// Entity icon for editor-drawn shapes (scene graph rows + properties panel
// header, via getEntityIcon). Same glyph as the ShapeDraw24Icon toolbar
// button, recolored to the managed-street icon language: cyan identity
// strokes, white detail (the dashed side).
export const ShapeIcon = () => (
  <svg
    width="25"
    height="25"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M4 18L9 5L19 8L20 18"
      stroke="#00FFFF"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
    <path
      d="M20 18L4 18"
      stroke="white"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeDasharray="3 4"
      fill="none"
    />
    <circle cx="4" cy="18" r="1.8" fill="#00FFFF" />
    <circle cx="9" cy="5" r="1.8" fill="#00FFFF" />
    <circle cx="19" cy="8" r="1.8" fill="#00FFFF" />
    <circle cx="20" cy="18" r="1.8" fill="#00FFFF" />
  </svg>
);

export const Ruler24Icon = () => (
  <svg
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M18.6666 0L0 18.6667L5.33333 24L7.5956 21.7377L7.5971 21.7392L8.5399 20.7965L8.5384 20.795L9.48123 19.8521L9.48271 19.8536L10.4255 18.9109L10.424 18.9094L11.3668 17.9665L11.3683 17.968L12.3111 17.0252L12.3097 17.0237L13.2525 16.081L13.254 16.0824L14.1967 15.1396L14.1952 15.1381L15.1381 14.1954L15.1396 14.1967L16.0824 13.254L16.0809 13.2525L17.0238 12.3097L17.0253 12.3112L17.968 11.3684L17.9665 11.3669L18.9094 10.4241L18.9107 10.4255L19.8536 9.48273L19.8521 9.48124L20.795 8.53842L20.7964 8.53992L21.7392 7.59711L21.7377 7.59563L24 5.33335L18.6666 0ZM20.795 6.65281L22.1144 5.33335L18.6666 1.88562L1.88562 18.6667L5.33333 22.1145L6.65279 20.795L5.40034 19.5425L6.34314 18.5997L7.5956 19.8521L8.53842 18.9094L7.28596 17.6569L8.22877 16.7141L9.48123 17.9665L10.424 17.0237L8.22875 14.8285L9.17158 13.8856L11.3669 16.0808L12.3097 15.1381L11.0572 13.8856L12 12.9428L13.2525 14.1954L14.1952 13.2525L12.9429 12L13.8856 11.0572L15.1381 12.3097L16.0809 11.3669L13.8856 9.17159L14.8285 8.22879L17.0238 10.4241L17.9665 9.48124L16.714 8.22879L17.6569 7.28598L18.9094 8.53842L19.8521 7.59562L18.5996 6.34316L19.5425 5.40035L20.795 6.65281Z"
      fill="white"
    />
  </svg>
);

export const RailIcon = () => (
  <svg
    width="8"
    height="23"
    viewBox="0 0 8 23"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M5.5 1L5.5 22" stroke="#00FFFF" strokeLinecap="round" />
    <path
      d="M7 20H1"
      stroke="#00FFFF"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <path
      d="M7 17H1"
      stroke="#00FFFF"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <path
      d="M7 14H1"
      stroke="#00FFFF"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <path
      d="M7 11H1"
      stroke="#00FFFF"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <path d="M7 8H1" stroke="#00FFFF" strokeWidth="1.5" strokeLinecap="round" />
    <path
      d="M7 5L1 5"
      stroke="#00FFFF"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <path
      d="M7 2L1 2"
      stroke="#00FFFF"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <path d="M2.5 1L2.5 22" stroke="#00FFFF" strokeLinecap="round" />
  </svg>
);

// Illustration-grade art: served from ui_assets (cached, on-demand)
// instead of inlining tens of KiB of path data into the JS bundle.
export const PedestriansIcon = () => (
  <img src="/ui_assets/icons/pedestrians.svg" width="28" height="23" alt="" />
);

export const StreetSurfaceIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M19.5358 5.44066C19.5358 4.30253 18.5511 3.36642 17.2882 3.25144C16.9337 2.41305 16.0164 1.81432 14.937 1.81432C14.4645 1.81432 14.0241 1.931 13.6469 2.13009C13.2179 1.45627 12.3979 1 11.4553 1C10.2057 1 9.17228 1.80217 8.98051 2.85084C8.87852 2.83991 8.77543 2.83236 8.67011 2.83236C7.28415 2.83236 6.16036 3.81784 6.16036 5.03372C6.16036 5.09328 6.16535 5.15162 6.17062 5.20996C5.46782 5.60012 5 6.28609 5 7.06955C5 7.76211 5.36528 8.37904 5.93532 8.78256C5.93283 8.82219 5.9284 8.86154 5.9284 8.90168C5.9284 10.1173 7.05193 11.103 8.43814 11.103C8.85357 11.103 9.24432 11.0131 9.58938 10.8566C10.0674 11.1578 10.752 11.5345 11.0834 11.4594C11.0834 11.4594 11.2067 13.1348 11.1801 13.5602C11.1294 14.3696 10.8525 15.2707 10.6577 16H13.6752C13.6752 16 13.2304 14.3743 13.211 13.8315C13.1916 13.2886 13.4044 12.2891 13.4044 12.2891L14.4512 11.3394C14.8541 11.581 15.3408 11.7183 15.8657 11.7183C17.1632 11.7183 18.2305 10.8525 18.3616 9.7447C19.3174 9.43381 20 8.62701 20 7.6802C20 7.1211 19.7606 6.61257 19.3692 6.22414C19.4751 5.98054 19.5358 5.71705 19.5358 5.44066ZM10.1691 10.4931C10.3703 10.3247 10.5391 10.1278 10.668 9.90925L11.1607 10.8147C11.1604 10.8148 10.8924 10.9185 10.1691 10.4931ZM12.0115 11.0522C11.7566 11.0928 11.3223 10.4042 11.0141 9.84432C11.3558 9.99723 11.7416 10.0852 12.1518 10.0852C12.2571 10.0852 12.3605 10.0777 12.4624 10.0665C12.3832 10.5145 12.2435 11.015 12.0115 11.0522ZM13.0949 11.4929C12.5051 11.6366 12.8582 10.5651 13.0272 9.94474C13.1495 9.90488 13.2678 9.85798 13.3803 9.80228C13.4482 10.2544 13.6721 10.6623 14.0039 10.9849C13.7165 11.2088 13.3856 11.4222 13.0949 11.4929Z"
      fill="#888888"
    />
    <rect
      x="3.5"
      y="16.75"
      width="17.5"
      height="5.25"
      rx="2"
      stroke="#00FFFF"
      strokeWidth="2"
    />
  </svg>
);

export const ManagedStreetIcon = () => (
  <svg
    width="25"
    height="25"
    viewBox="0 0 25 25"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M18 2L18 23"
      stroke="white"
      strokeLinecap="round"
      strokeDasharray="3 4"
    />
    <path
      d="M7 2L7 23"
      stroke="white"
      strokeLinecap="round"
      strokeDasharray="3 4"
    />
    <path
      d="M13 2L13 23"
      stroke="white"
      strokeWidth="0.5"
      strokeLinecap="round"
    />
    <path
      d="M12 2L12 23"
      stroke="white"
      strokeWidth="0.5"
      strokeLinecap="round"
    />
    <rect
      x="1"
      y="1"
      width="23"
      height="23"
      rx="2"
      stroke="#00FFFF"
      strokeWidth="2"
    />
  </svg>
);

// Entity icon for managed intersections (scene graph rows + properties panel
// header, via getEntityIcon). Same icon language as ManagedStreetIcon: cyan
// identity stroke (here the crossing roadways outline), white dashed
// centerline detail.
export const ManagedIntersectionIcon = () => (
  <svg
    width="25"
    height="25"
    viewBox="0 0 25 25"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M9 1H16V9H24V16H16V24H9V16H1V9H9V1Z"
      stroke="#00FFFF"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path
      d="M12.5 3L12.5 22"
      stroke="white"
      strokeLinecap="round"
      strokeDasharray="3 4"
    />
    <path
      d="M3 12.5L22 12.5"
      stroke="white"
      strokeLinecap="round"
      strokeDasharray="3 4"
    />
  </svg>
);

export const SegmentIcon = () => (
  <svg
    width="24"
    height="25"
    viewBox="0 0 24 25"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M17 2L17 23"
      stroke="white"
      strokeLinecap="round"
      strokeDasharray="3 4"
    />
    <path
      d="M6 2L6 23"
      stroke="white"
      strokeLinecap="round"
      strokeDasharray="3 4"
    />
    <path
      d="M12 2L12 23"
      stroke="white"
      strokeWidth="0.5"
      strokeLinecap="round"
    />
    <path
      d="M11 2L11 23"
      stroke="white"
      strokeWidth="0.5"
      strokeLinecap="round"
    />
    <rect
      x="0.75"
      y="1.75"
      width="21.5"
      height="21.5"
      rx="1.25"
      stroke="#929292"
      strokeWidth="1.5"
    />
    <rect
      x="9"
      y="1"
      width="8"
      height="23"
      rx="2"
      stroke="#00FFFF"
      strokeWidth="2"
    />
  </svg>
);

export const ArrowLeftHookIcon = () => (
  <svg
    width="26"
    height="26"
    viewBox="0 0 26 26"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M10.3245 21.1578C10.6418 20.8405 10.6418 20.3261 10.3245 20.0088L7.3782 17.0625H17.3333C18.6981 17.0625 20.0069 16.5203 20.972 15.5553C21.937 14.5903 22.4792 13.2814 22.4792 11.9166C22.4792 10.5519 21.937 9.24302 20.972 8.27799C20.0069 7.31296 18.6981 6.77081 17.3333 6.77081H16.25C15.8013 6.77081 15.4375 7.13458 15.4375 7.58331C15.4375 8.03204 15.8013 8.39581 16.25 8.39581H17.3333C18.2671 8.39581 19.1626 8.76676 19.8229 9.42704C20.4832 10.0873 20.8542 10.9829 20.8542 11.9166C20.8542 12.8504 20.4832 13.746 19.8229 14.4063C19.1626 15.0665 18.2671 15.4375 17.3333 15.4375H7.3782L10.3245 12.4912C10.6418 12.1739 10.6418 11.6594 10.3245 11.3421C10.0072 11.0248 9.49277 11.0248 9.17547 11.3421L4.84246 15.6751C4.84235 15.6752 4.84224 15.6753 4.84213 15.6755C4.84156 15.676 4.84098 15.6766 4.84041 15.6772C4.76337 15.7547 4.70517 15.8438 4.66581 15.939C4.62608 16.0348 4.60416 16.1398 4.60416 16.25C4.60416 16.4735 4.69439 16.6759 4.84041 16.8228C4.84098 16.8234 4.84156 16.8239 4.84213 16.8245C4.84224 16.8246 4.84235 16.8247 4.84246 16.8248L9.17547 21.1578C9.49277 21.4751 10.0072 21.4751 10.3245 21.1578Z"
      fill="white"
    />
  </svg>
);

export const ManualIcon = () => (
  <svg
    width="25"
    height="30"
    viewBox="0 0 25 30"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M5.15243 7.90909H8.56578L12.1709 16.7045H12.3243L15.9294 7.90909H19.3428V21H16.6581V12.4794H16.5495L13.1617 20.9361H11.3335L7.94576 12.4474H7.83709V21H5.15243V7.90909Z"
      fill="#EA4335"
    />
    <path
      d="M12.2572 28.8995L0.5 20.9199V8.37301L12.2571 0.595916L24.5 8.37889V20.914L12.2572 28.8995Z"
      fill="#EA4335"
      fillOpacity="0.23"
      stroke="#EA4335"
    />
  </svg>
);

export const AutoIcon = () => (
  <svg
    width="27"
    height="26"
    viewBox="0 0 27 26"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <circle
      cx="13.5"
      cy="13"
      r="12.5"
      fill="#0EAF00"
      fillOpacity="0.17"
      stroke="#0EAF00"
    />
    <path
      d="M10.1618 19H7.19585L11.715 5.90909H15.2818L19.7946 19H16.8287L13.5495 8.90057H13.4473L10.1618 19ZM9.97638 13.8544H16.9821V16.0149H9.97638V13.8544Z"
      fill="#0EAF00"
    />
  </svg>
);

// Illustration-grade art: served from ui_assets (cached, on-demand)
// instead of inlining tens of KiB of path data into the JS bundle.
export const ClonedTreesIcon = () => (
  <img src="/ui_assets/icons/cloned-trees.svg" width="25" height="23" alt="" />
);

export const StencilsIcon = () => (
  <svg
    width="25"
    height="23"
    viewBox="0 0 25 23"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M12.3029 1L15.5949 7.05015L8.83301 7.05015L12.3029 1Z"
      fill="#00FFFF"
    />
    <path
      d="M23.0686 10.965L19.1538 6.69424L19.1538 15.2356L23.0686 10.965Z"
      fill="#00FFFF"
    />
    <path
      d="M2.07111 10.965L5.98592 15.5915L5.98592 6.69427L2.07111 10.965Z"
      fill="#00FFFF"
    />
    <path
      d="M12.8462 7.40607L13.1037 20.2181H11.6801V7.40607H12.8462Z"
      fill="#00FFFF"
    />
    <path
      d="M12.7478 20.2181C12.7478 20.2181 12.036 17.0151 14.1713 14.168"
      stroke="#00FFFF"
      strokeWidth="1.77946"
    />
    <path
      d="M14.8831 13.4562C14.8831 13.4562 16.8263 10.9073 18.442 10.9649"
      stroke="#00FFFF"
      strokeWidth="1.77946"
    />
    <path
      d="M10.2566 13.4562C9.18888 12.0326 7.7653 10.9649 6.69763 10.8756"
      stroke="#00FFFF"
      strokeWidth="1.77946"
    />
    <path
      d="M12.7478 19.8622C12.7478 19.8622 12.036 15.5916 10.6124 14.168"
      stroke="#00FFFF"
      strokeWidth="1.77946"
    />
  </svg>
);

export const StripingIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M18 1L18 22"
      stroke="#00FFFF"
      strokeWidth="2"
      strokeLinecap="round"
      strokeDasharray="3 4"
    />
    <path
      d="M5 1L5 22"
      stroke="#00FFFF"
      strokeWidth="2"
      strokeLinecap="round"
      strokeDasharray="3 4"
    />
    <path
      d="M13 1L13 22"
      stroke="#00FFFF"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <path
      d="M10 1L10 22"
      stroke="#00FFFF"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
    <rect
      x="0.25"
      y="0.25"
      width="22.5"
      height="22.5"
      rx="1.75"
      stroke="#929292"
      strokeWidth="0.5"
    />
  </svg>
);
